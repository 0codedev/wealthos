"""
Unit Tests for Real-Time Options Surface Local Volatility Dupire Inversion Engine (Domain 165 / WP-BO)
"""

import math
import pytest
from services.dupire_local_volatility_engine import (
    DupireLocalVolatilityEngine,
    LocalVolReport,
)


def norm_cdf(x: float) -> float:
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0


def black_scholes_call(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0:
        return max(0.0, S - K)
    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return S * norm_cdf(d1) - K * math.exp(-r * T) * norm_cdf(d2)


@pytest.fixture
def engine():
    return DupireLocalVolatilityEngine(
        db_path=":memory:",
        risk_free_rate=0.05,
        min_local_vol=0.05,
        max_local_vol=1.50,
    )


def test_dupire_local_vol_calibration_valid(engine):
    # Under constant Black-Scholes vol sigma = 0.20, Dupire local vol must equal 0.20!
    S = 100.0
    K = 100.0
    T = 0.50
    r = 0.05
    sigma = 0.20
    dK = 1.0
    dT = 0.01

    c_k_t = black_scholes_call(S, K, T, r, sigma)
    c_k_plus_t = black_scholes_call(S, K + dK, T, r, sigma)
    c_k_minus_t = black_scholes_call(S, K - dK, T, r, sigma)
    c_k_t_plus = black_scholes_call(S, K, T + dT, r, sigma)

    rep = engine.evaluate_dupire_local_vol(
        symbol="NIFTY",
        strike=K,
        maturity=T,
        c_k_t=c_k_t,
        c_k_plus_t=c_k_plus_t,
        c_k_minus_t=c_k_minus_t,
        c_k_t_plus=c_k_t_plus,
        delta_k=dK,
        delta_t=dT,
    )

    assert rep.is_arbitrage_free is True
    # Local vol should recover 0.20 within 2% numerical discretization error
    assert rep.local_vol == pytest.approx(0.20, abs=0.015)
    assert rep.regime == "DUPIRE_LOCAL_VOLATILITY_CALIBRATED"
    assert rep.trade_directive == "VALID_FOR_EXOTIC_BARRIER_PDE_PRICING"


def test_butterfly_convexity_arbitrage_detected(engine):
    # Strike convexity violation: middle call price is artificially elevated
    # c_plus - 2*c_mid + c_minus < 0
    c_k_t = 12.0  # Artificially overpriced
    c_k_plus_t = 10.0
    c_k_minus_t = 11.0  # 10 - 24 + 11 = -3 < 0!
    c_k_t_plus = 12.5

    rep = engine.evaluate_dupire_local_vol(
        symbol="ARB_SYM",
        strike=100.0,
        maturity=0.5,
        c_k_t=c_k_t,
        c_k_plus_t=c_k_plus_t,
        c_k_minus_t=c_k_minus_t,
        c_k_t_plus=c_k_t_plus,
        delta_k=5.0,
        delta_t=0.05,
    )

    assert rep.is_arbitrage_free is False
    assert rep.regime == "BUTTERFLY_CONVEXITY_ARBITRAGE_DETECTED"
    assert rep.trade_directive == "EXECUTE_STATIC_BUTTERFLY_ARBITRAGE"


def test_calendar_negative_time_decay_violation(engine):
    # Calendar violation: Call with longer maturity is cheaper!
    # c_k_t_plus < c_k_t
    c_k_t = 8.0
    c_k_plus_t = 6.0
    c_k_minus_t = 10.5  # Convexity is fine: 6 - 16 + 10.5 = 0.5 > 0
    c_k_t_plus = 7.0   # Cheaper than current! dC/dT < 0

    rep = engine.evaluate_dupire_local_vol(
        symbol="CAL_SYM",
        strike=100.0,
        maturity=0.5,
        c_k_t=c_k_t,
        c_k_plus_t=c_k_plus_t,
        c_k_minus_t=c_k_minus_t,
        c_k_t_plus=c_k_t_plus,
        delta_k=5.0,
        delta_t=0.05,
    )

    assert rep.is_arbitrage_free is False
    assert rep.regime == "CALENDAR_NEGATIVE_TIME_DECAY_VIOLATION"
    assert rep.trade_directive == "EXECUTE_CALENDAR_SPREAD_ARBITRAGE"


def test_sqlite_persistence(engine):
    engine.evaluate_dupire_local_vol(
        "PERSIST_SYM", 100.0, 0.5, 8.0, 6.0, 10.5, 8.2, 5.0, 0.05
    )

    conn = engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, strike, local_vol, regime FROM dupire_local_vol_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
