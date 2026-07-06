"""
Unit Tests for Cross-Asset Sovereign Treasury Curve Inversion & Equity Tail Risk Predictor (Domain 149 / WP-AY)
"""

import math
import pytest

from services.sovereign_yield_curve_engine import (
    SovereignYieldCurveEngine,
    SovereignMaturityYields,
    YieldCurveAnalysisReport,
)


@pytest.fixture
def engine():
    return SovereignYieldCurveEngine(
        db_path=":memory:",
        inversion_hurdle_bps=0.0,
    )


def test_normal_upward_sloping_curve(engine):
    # Benchmark Indian G-Sec normal expansion: 3M = 6.50%, 2Y = 6.80%, 5Y = 7.05%, 10Y = 7.30%
    yields = SovereignMaturityYields(
        y_91d=0.0650,
        y_2y=0.0680,
        y_5y=0.0705,
        y_10y=0.0730,
    )
    rep = engine.analyze_yield_curve(yields)

    assert rep.slope_10_2_bps == 50.0  # +50 bps
    assert rep.slope_10_3m_bps == 80.0  # +80 bps
    assert rep.tail_risk_hazard <= 0.25
    assert rep.macro_leverage_multiplier >= 0.85
    assert rep.regime == "NORMAL_EXPANSION_CURVE"
    assert rep.risk_directive == "FULL_EQUITY_LONG_BETA_UNCONSTRAINED"
    assert rep.ns_beta1 < 0.0  # Upward slope means beta1 is negative


def test_inverted_yield_curve_hazard(engine):
    # Deep inversion: Short rates spiked by RBI emergency liquidity squeeze
    # 3M = 7.60%, 2Y = 7.50%, 5Y = 7.15%, 10Y = 7.00%
    yields = SovereignMaturityYields(
        y_91d=0.0760,
        y_2y=0.0750,
        y_5y=0.0715,
        y_10y=0.0700,
    )
    rep = engine.analyze_yield_curve(yields)

    assert rep.slope_10_2_bps == -50.0  # -50 bps deep inversion
    assert rep.slope_10_3m_bps == -60.0  # -60 bps
    assert rep.tail_risk_hazard >= 0.75
    assert rep.macro_leverage_multiplier <= 0.60
    assert rep.regime in ("INVERTED_CURVE_ALERT", "ACUTE_MACRO_TAIL_HAZARD")
    assert rep.risk_directive in ("HEDGE_EQUITIES_WITH_NIFTY_PUTS", "DELEVERAGE_MAX_ACCUMULATE_CASH_LIQUID")


def test_nelson_siegel_fitting_stability(engine):
    yields = SovereignMaturityYields(
        y_91d=0.0670,
        y_2y=0.0690,
        y_5y=0.0710,
        y_10y=0.0725,
        lambda_decay=2.0,
    )
    b0, b1, b2 = engine.fit_nelson_siegel(yields)

    assert math.isfinite(b0)
    assert math.isfinite(b1)
    assert math.isfinite(b2)
    # Long-term level beta0 should be near 7.0% - 7.5%
    assert 0.065 < b0 < 0.080


def test_flattening_curve_monitor(engine):
    # Flat curve: 10Y-2Y slope compressed to +5 bps
    yields = SovereignMaturityYields(
        y_91d=0.0705,
        y_2y=0.0710,
        y_5y=0.0712,
        y_10y=0.0715,
    )
    rep = engine.analyze_yield_curve(yields)

    assert rep.slope_10_2_bps == 5.0
    assert 0.25 < rep.tail_risk_hazard <= 0.55
    assert rep.regime == "FLATTENING_CURVE_MONITOR"
    assert rep.risk_directive == "TRIM_HIGH_BETA_TIGHTEN_STOPS"
    assert 0.65 <= rep.macro_leverage_multiplier <= 0.85


def test_sqlite_persistence(engine):
    yields = SovereignMaturityYields(
        y_91d=0.065,
        y_2y=0.068,
        y_5y=0.070,
        y_10y=0.072,
    )
    engine.analyze_yield_curve(yields)

    conn = engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT y_10y, slope_10_2, tail_risk_hazard, regime FROM sovereign_yield_curve_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == 7.2
    assert row[1] == 40.0
    assert isinstance(row[3], str)
