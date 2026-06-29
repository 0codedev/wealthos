"""
Unit Tests for Sub-Millisecond Options Greeks Cross-Gamma & Speed Sieve (Domain 143 / WP-AS)
"""

import math
import pytest

from services.cross_gamma_speed_engine import (
    CrossGammaSpeedEngine,
    OptionContract,
    ConstituentAsset,
    HigherOrderGreeks,
    CrossGammaMatrixReport,
)


@pytest.fixture
def engine():
    return CrossGammaSpeedEngine(
        db_path=":memory:",
        gamma_crit=0.0020,
    )


def test_higher_order_greeks_atm_call(engine):
    contract = OptionContract(
        symbol="NIFTY26OCT25000CE",
        spot=25000.0,
        strike=25000.0,
        tte_years=30.0 / 365.0,
        volatility=0.18,
        rate=0.065,
        dividend_yield=0.012,
        option_type="CE",
    )
    greeks = engine.calculate_higher_order_greeks(contract)

    assert 0.45 < greeks.delta < 0.60
    assert greeks.gamma > 0.0
    assert greeks.vega > 0.0
    assert greeks.theta < 0.0
    assert math.isfinite(greeks.speed)
    assert math.isfinite(greeks.zomma)
    assert math.isfinite(greeks.color)
    assert 0.0 <= greeks.hazard_score <= 1.0
    assert greeks.recommended_action in ("STABLE_GAMMA", "ELEVATED_SPEED_MONITOR")
    assert greeks.rebalance_tolerance_pct in (6.0, 10.0)


def test_speed_moneyness_asymmetry(engine):
    """
    Mathematical Invariant: Speed (dGamma/dSpot) is positive for OTM options
    (as spot rises towards strike, gamma increases) and negative for ITM options
    (as spot rises away from strike, gamma decreases).
    """
    t = 15.0 / 365.0
    vol = 0.20

    # OTM Call: Spot 24500 < Strike 25000
    otm_call = OptionContract("NIFTY_OTM", 24500.0, 25000.0, t, vol, option_type="CE")
    otm_greeks = engine.calculate_higher_order_greeks(otm_call)

    # ITM Call: Spot 25500 > Strike 25000
    itm_call = OptionContract("NIFTY_ITM", 25500.0, 25000.0, t, vol, option_type="CE")
    itm_greeks = engine.calculate_higher_order_greeks(itm_call)

    assert otm_greeks.speed > 0.0, "OTM Call must have positive Speed"
    assert itm_greeks.speed < 0.0, "ITM Call must have negative Speed"


def test_0dte_terminal_pin_risk_hazard(engine):
    """
    Near-expiry ATM contracts experience gamma/speed divergence,
    triggering high hazard score and tight rebalancing tolerance.
    """
    # 15 minutes before 15:30 IST expiry
    tte_15min = 15.0 / (365.0 * 24.0 * 60.0)
    contract = OptionContract(
        symbol="NIFTY_0DTE_ATM",
        spot=25000.0,
        strike=25000.0,
        tte_years=tte_15min,
        volatility=0.18,
        option_type="CE",
    )
    greeks = engine.calculate_higher_order_greeks(contract)

    assert greeks.gamma > 0.005  # Highly elevated gamma
    assert greeks.hazard_score >= 0.80
    assert greeks.recommended_action in ("TERMINAL_PIN_HAZARD_CLOSE", "HIGH_PIN_RISK_TIGHTEN")
    assert greeks.rebalance_tolerance_pct <= 4.0


def test_cross_gamma_basket_matrix(engine):
    idx_contract = OptionContract(
        symbol="NIFTY50",
        spot=25000.0,
        strike=25000.0,
        tte_years=10.0 / 365.0,
        volatility=0.16,
        option_type="CE",
    )
    constituents = [
        ConstituentAsset("HDFCBANK", 1700.0, 0.30),
        ConstituentAsset("RELIANCE", 3000.0, 0.30),
        ConstituentAsset("ICICIBANK", 1250.0, 0.20),
        ConstituentAsset("INFY", 1900.0, 0.20),
    ]

    report = engine.compute_basket_cross_gamma(idx_contract, constituents)

    assert len(report.constituents) == 4
    assert len(report.gamma_matrix) == 4
    assert len(report.gamma_matrix[0]) == 4

    # Matrix symmetry: Gamma_ij == Gamma_ji
    for i in range(4):
        for j in range(4):
            assert math.isclose(report.gamma_matrix[i][j], report.gamma_matrix[j][i], rel_tol=1e-9)

    # Diagonal direct gammas
    for i, sym in enumerate(report.constituents):
        w = report.weights[i]
        expected_direct = report.index_gamma * (w ** 2)
        assert math.isclose(report.direct_gammas[sym], expected_direct, rel_tol=1e-9)

    # Aggregate curvature conservation
    assert math.isclose(report.aggregate_basket_curvature, report.index_gamma, rel_tol=1e-7)


def test_sqlite_persistence(engine):
    contract = OptionContract(
        symbol="NIFTY_TEST",
        spot=25000.0,
        strike=25000.0,
        tte_years=20.0 / 365.0,
        volatility=0.17,
        option_type="CE",
    )
    engine.calculate_higher_order_greeks(contract)

    conn = engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, gamma, speed, hazard_score, recommended_action FROM cross_gamma_speed_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "NIFTY_TEST"
    assert row[1] > 0.0
    assert row[3] >= 0.0
    assert isinstance(row[4], str)
