"""Unit tests for python-bridge/services/max_pain_pinning_engine.py (Domain 118)."""
from __future__ import annotations

import os
import sys
import time
import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.max_pain_pinning_engine import (
    OptionStrikeRecord,
    BlackScholesGamma,
    MaxPainPinningEngine,
    GammaRegime,
    PinningState,
)


def test_black_scholes_gamma():
    gamma = BlackScholesGamma.gamma(spot=25000.0, strike=25000.0, time_to_expiry_years=7.0 / 365.0, iv=0.15)
    assert gamma > 0.0
    # Deep OTM strike should have lower gamma
    gamma_otm = BlackScholesGamma.gamma(spot=25000.0, strike=27000.0, time_to_expiry_years=7.0 / 365.0, iv=0.15)
    assert gamma > gamma_otm


def test_compute_max_pain_basic():
    engine = MaxPainPinningEngine(db_path=":memory:")
    # Symmetric option chain: maximum OI at 25000
    chain = [
        OptionStrikeRecord(strike=24800.0, call_oi=10000, put_oi=50000),
        OptionStrikeRecord(strike=24900.0, call_oi=20000, put_oi=40000),
        OptionStrikeRecord(strike=25000.0, call_oi=100000, put_oi=100000), # Peak OI
        OptionStrikeRecord(strike=25100.0, call_oi=40000, put_oi=20000),
        OptionStrikeRecord(strike=25200.0, call_oi=50000, put_oi=10000),
    ]

    res = engine.compute_max_pain("NIFTY", spot=24980.0, chain=chain)
    assert res.max_pain_strike == 25000.0
    assert pytest.approx(res.pain_distance_pts, 1e-4) == -20.0
    assert pytest.approx(res.call_put_oi_ratio, 1e-4) == 1.0


def test_compute_max_pain_asymmetric():
    engine = MaxPainPinningEngine(db_path=":memory:")
    # Massive call writing at 25200 pulls max pain lower towards 25000
    chain = [
        OptionStrikeRecord(strike=24800.0, call_oi=5000, put_oi=80000),
        OptionStrikeRecord(strike=25000.0, call_oi=20000, put_oi=60000),
        OptionStrikeRecord(strike=25200.0, call_oi=150000, put_oi=10000),
    ]

    res = engine.compute_max_pain("NIFTY", spot=25100.0, chain=chain)
    assert res.max_pain_strike == 25000.0


def test_gex_profile_positive_gamma():
    engine = MaxPainPinningEngine(db_path=":memory:")
    # Heavy call open interest -> dealers long gamma -> positive GEX
    chain = [
        OptionStrikeRecord(strike=25000.0, call_oi=200000, put_oi=10000, call_iv=0.15, put_iv=0.15),
        OptionStrikeRecord(strike=25100.0, call_oi=150000, put_oi=10000, call_iv=0.15, put_iv=0.15),
    ]

    gex = engine.compute_gex_profile("NIFTY", spot=25000.0, chain=chain, time_to_expiry_days=0.5)
    assert gex.net_gex_crores > 0.0
    assert gex.gamma_regime == GammaRegime.POSITIVE_GAMMA_PINNED
    assert gex.call_gamma_wall == 25000.0


def test_gex_profile_negative_gamma():
    engine = MaxPainPinningEngine(db_path=":memory:")
    # Heavy put open interest -> dealers short gamma -> negative GEX
    chain = [
        OptionStrikeRecord(strike=25000.0, call_oi=10000, put_oi=200000, call_iv=0.15, put_iv=0.15),
        OptionStrikeRecord(strike=24900.0, call_oi=10000, put_oi=150000, call_iv=0.15, put_iv=0.15),
    ]

    gex = engine.compute_gex_profile("NIFTY", spot=25000.0, chain=chain, time_to_expiry_days=0.5)
    assert gex.net_gex_crores < 0.0
    assert gex.gamma_regime == GammaRegime.NEGATIVE_GAMMA_SQUEEZE


def test_pinning_probability_decay():
    engine = MaxPainPinningEngine(db_path=":memory:")
    chain = [OptionStrikeRecord(strike=25000.0, call_oi=100000, put_oi=10000, call_iv=0.15, put_iv=0.15)]

    gex_0dte = engine.compute_gex_profile("NIFTY", spot=25000.0, chain=chain, time_to_expiry_days=0.2)
    gex_7dte = engine.compute_gex_profile("NIFTY", spot=25000.0, chain=chain, time_to_expiry_days=7.0)

    assert gex_0dte.pinning_probability > gex_7dte.pinning_probability


def test_alert_pinned_to_pain():
    engine = MaxPainPinningEngine(db_path=":memory:")
    chain = [
        OptionStrikeRecord(strike=25000.0, call_oi=150000, put_oi=20000, call_iv=0.15, put_iv=0.15),
    ]

    res = engine.compute_max_pain("NIFTY", spot=25010.0, chain=chain)
    gex = engine.compute_gex_profile("NIFTY", spot=25010.0, chain=chain, time_to_expiry_days=0.1)

    alert = engine.evaluate_pinning_alerts("NIFTY", spot=25010.0, pain_result=res, gex_profile=gex, atr_14=100.0)
    assert alert is not None
    assert alert.state == PinningState.PINNED_TO_PAIN
    assert alert.max_pain_strike == 25000.0


def test_alert_squeeze_breakout():
    engine = MaxPainPinningEngine(db_path=":memory:")
    chain = [
        OptionStrikeRecord(strike=25000.0, call_oi=10000, put_oi=200000, call_iv=0.15, put_iv=0.15),
        OptionStrikeRecord(strike=25200.0, call_oi=50000, put_oi=10000, call_iv=0.15, put_iv=0.15),
    ]

    # Spot spikes to 25250 (breaches call wall 25200 in negative gamma)
    res = engine.compute_max_pain("NIFTY", spot=25250.0, chain=chain)
    gex = engine.compute_gex_profile("NIFTY", spot=25250.0, chain=chain, time_to_expiry_days=0.5)

    alert = engine.evaluate_pinning_alerts("NIFTY", spot=25250.0, pain_result=res, gex_profile=gex)
    assert alert is not None
    assert alert.state == PinningState.SQUEEZE_BREAKOUT


def test_alert_migrating_pain():
    engine = MaxPainPinningEngine(db_path=":memory:")
    chain1 = [OptionStrikeRecord(strike=25000.0, call_oi=100000, put_oi=50000)]
    chain2 = [OptionStrikeRecord(strike=25100.0, call_oi=150000, put_oi=20000)]

    # Mock historical drift
    t0 = time.time() - 3600.0  # 1 hour ago
    engine.pain_history["BANKNIFTY"] = [(t0, 52000.0)]

    res = engine.compute_max_pain("BANKNIFTY", spot=52150.0, chain=chain2)
    # Replaced last entry with new strike 52100 (+100 pts in 1 hr)
    engine.pain_history["BANKNIFTY"].append((time.time(), 52100.0))

    gex = engine.compute_gex_profile("BANKNIFTY", spot=52150.0, chain=chain2, time_to_expiry_days=1.0)
    alert = engine.evaluate_pinning_alerts("BANKNIFTY", spot=52150.0, pain_result=res, gex_profile=gex, atr_14=50.0)

    assert alert is not None
    assert alert.state == PinningState.MIGRATING_PAIN
    assert alert.drift_velocity_pts_hr >= 50.0


def test_sqlite_persistence():
    engine = MaxPainPinningEngine(db_path=":memory:")
    chain = [OptionStrikeRecord(strike=25000.0, call_oi=150000, put_oi=20000, call_iv=0.15, put_iv=0.15)]

    res = engine.compute_max_pain("NIFTY", spot=25000.0, chain=chain)
    gex = engine.compute_gex_profile("NIFTY", spot=25000.0, chain=chain, time_to_expiry_days=0.1)
    engine.evaluate_pinning_alerts("NIFTY", spot=25000.0, pain_result=res, gex_profile=gex, atr_14=100.0)

    conn = engine._get_connection()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM max_pain_snapshots")
    assert cur.fetchone()[0] == 1

    cur.execute("SELECT COUNT(*) FROM pinning_alerts")
    assert cur.fetchone()[0] == 1
