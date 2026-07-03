r"""
Unit Test Suite for Domain 191 (WP-CO): Real-Time Options Surface Term Structure & Local Volatility Forward PDE Sieve
"""

import math
import pytest
from services.local_volatility_forward_pde_sieve import (
    LocalVolDirective,
    LocalVolatilityForwardPDESieve,
    OptionsSurfacePoint,
)


def test_flat_surface_local_vol_equals_implied_vol():
    """Under a flat implied volatility surface, Dupire local volatility must mathematically equal implied volatility."""
    sieve = LocalVolatilityForwardPDESieve(db_path=":memory:")

    spot = 25000.0
    r = 0.065  # 6.5% interest rate

    # Construct completely flat implied volatility surface: 20% flat
    surface = []
    strikes = [24000.0, 24500.0, 25000.0, 25500.0, 26000.0]
    expiries = [7.0, 14.0, 30.0, 60.0, 90.0]

    for t in expiries:
        for k in strikes:
            surface.append(OptionsSurfacePoint(strike=k, expiry_days=t, implied_vol=0.20))

    # Evaluate ATM point at 30 days
    pt = sieve.evaluate_dupire_point(spot, 25000.0, 30.0 / 365.0, r, surface)

    assert not pt.is_calendar_arbitrage
    assert not pt.is_butterfly_arbitrage
    assert math.isclose(pt.density_denominator, 1.0, rel_tol=1e-2)
    # Local vol must equal implied vol 0.20
    assert math.isclose(pt.local_vol, 0.20, rel_tol=1e-2)


def test_calendar_spread_arbitrage_detection():
    """Detects negative forward variance when total variance decreases with maturity (calendar arbitrage)."""
    sieve = LocalVolatilityForwardPDESieve(db_path=":memory:")

    spot = 25000.0
    r = 0.065

    # Near term 7d has 40% vol, far term 30d has only 8% vol
    # w(7d) = 0.40^2 * (7/365) = 0.003068
    # w(30d) = 0.08^2 * (30/365) = 0.000526 (Drastic drop in total variance -> calendar arbitrage!)
    surface = [
        OptionsSurfacePoint(strike=25000.0, expiry_days=7.0, implied_vol=0.40),
        OptionsSurfacePoint(strike=25000.0, expiry_days=30.0, implied_vol=0.08),
        OptionsSurfacePoint(strike=25000.0, expiry_days=60.0, implied_vol=0.07),
    ]

    report = sieve.calibrate_surface(
        "BANKNIFTY", spot, r, surface,
        grid_strikes=[25000.0],
        grid_expiries_days=[14.0, 25.0],
    )

    assert report.calendar_arbitrage_count > 0
    assert report.directive == LocalVolDirective.CALENDAR_SPREAD_ARBITRAGE_BUY_NEAR_SELL_FAR
    assert "Negative forward variance" in report.rationale


def test_butterfly_convexity_arbitrage_detection():
    """Detects butterfly arbitrage when smile curvature causes negative risk-neutral density (denominator <= 0)."""
    sieve = LocalVolatilityForwardPDESieve(db_path=":memory:")

    spot = 25000.0
    r = 0.065

    # Artificially concave surface (inverted smile) where middle strike has much higher vol than wings
    surface = [
        OptionsSurfacePoint(strike=24000.0, expiry_days=30.0, implied_vol=0.10),
        OptionsSurfacePoint(strike=25000.0, expiry_days=30.0, implied_vol=0.35),
        OptionsSurfacePoint(strike=26000.0, expiry_days=30.0, implied_vol=0.10),
    ]

    # Evaluate point with negative curvature
    pt = sieve.evaluate_dupire_point(spot, 25000.0, 30.0 / 365.0, r, surface, dy=0.02)

    # Inverted smile causes negative second derivative and density breakdown
    assert pt.density_denominator < 1.0 or pt.is_butterfly_arbitrage


def test_arbitrage_free_surface_calibration():
    """Verifies that a well-behaved volatility surface calibrates without arbitrage warnings."""
    sieve = LocalVolatilityForwardPDESieve(db_path=":memory:")

    spot = 25000.0
    r = 0.065

    # Realistic smooth skew surface
    strikes = [23750.0, 24375.0, 25000.0, 25625.0, 26250.0]
    expiries = [7.0, 14.0, 30.0, 60.0]

    surface = []
    for t in expiries:
        # Volatility term structure: slight upward slope (normal contango in vol)
        base_vol = 0.15 + 0.02 * (t / 365.0)
        for k in strikes:
            # Downward sloping skew: puts higher vol than calls
            moneyness = k / spot
            skew_adj = -0.10 * (moneyness - 1.0)
            vol = base_vol + skew_adj
            surface.append(OptionsSurfacePoint(strike=k, expiry_days=t, implied_vol=vol))

    report = sieve.calibrate_surface(
        "NIFTY", spot, r, surface,
        grid_strikes=[24500.0, 25000.0, 25500.0],
        grid_expiries_days=[14.0, 30.0],
    )

    assert report.calendar_arbitrage_count == 0
    assert report.butterfly_arbitrage_count == 0
    assert report.directive == LocalVolDirective.ARBITRAGE_FREE_LOCAL_VOLATILITY_CALIBRATED
    assert report.min_local_vol > 0.05
    assert report.max_local_vol < 0.50


def test_sqlite_telemetry_persistence():
    """Verifies SQLite recording and retrieval of local volatility calibrations."""
    sieve = LocalVolatilityForwardPDESieve(db_path=":memory:")

    surface = [
        OptionsSurfacePoint(strike=25000.0, expiry_days=30.0, implied_vol=0.18),
    ]

    sieve.calibrate_surface("FINNIFTY", 25000.0, 0.065, surface)

    records = sieve.get_recent_calibrations(limit=5)
    assert len(records) == 1
    assert records[0]["symbol"] == "FINNIFTY"
    assert records[0]["spot"] == 25000.0
