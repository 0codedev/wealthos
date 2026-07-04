r"""Unit Tests for Real-Time Options Surface Term-Structure Forward Jump PDE Sieve (Domain 206 / WP-DD)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.options_forward_jump_pde_sieve import (
    OptionsForwardJumpPDESieve,
    VolSurfacePoint,
    SurfaceArbitrageType,
    JumpTailRegime,
)


@pytest.fixture
def sieve() -> OptionsForwardJumpPDESieve:
    return OptionsForwardJumpPDESieve(
        min_forward_variance_threshold=0.0001,
        butterfly_tolerance=-1e-5,
    )


def test_valid_surface_no_arbitrage(sieve: OptionsForwardJumpPDESieve):
    spot = 25000.0
    # Well-behaved term structure: IV is stable at 15%, so total variance w increases with T
    points = [
        VolSurfacePoint(strike=24500.0, expiry_years=0.10, implied_vol=0.16, underlying_spot=spot),
        VolSurfacePoint(strike=25000.0, expiry_years=0.10, implied_vol=0.15, underlying_spot=spot),
        VolSurfacePoint(strike=25500.0, expiry_years=0.10, implied_vol=0.145, underlying_spot=spot),

        VolSurfacePoint(strike=24500.0, expiry_years=0.25, implied_vol=0.165, underlying_spot=spot),
        VolSurfacePoint(strike=25000.0, expiry_years=0.25, implied_vol=0.155, underlying_spot=spot),
        VolSurfacePoint(strike=25500.0, expiry_years=0.25, implied_vol=0.150, underlying_spot=spot),
    ]

    report = sieve.analyze_surface(points)

    assert report.arbitrage_type == SurfaceArbitrageType.NO_ARBITRAGE_VALID
    assert report.min_forward_variance > 0.0
    assert len(report.calendar_arbitrage_opportunities) == 0
    assert "satisfies all no-arbitrage bounds" in report.tactical_directive


def test_calendar_spread_negative_forward_variance(sieve: OptionsForwardJumpPDESieve):
    spot = 25000.0
    # Severe inversion at 25000: Near-term total variance > Far-term total variance
    # T1 = 0.25y, IV = 30% -> w1 = 0.09 * 0.25 = 0.0225
    # T2 = 0.30y, IV = 18% -> w2 = 0.0324 * 0.30 = 0.00972
    # w2 - w1 = -0.01278 < 0 -> Negative forward variance!
    points = [
        VolSurfacePoint(strike=25000.0, expiry_years=0.25, implied_vol=0.30, underlying_spot=spot),
        VolSurfacePoint(strike=25000.0, expiry_years=0.30, implied_vol=0.18, underlying_spot=spot),
    ]

    report = sieve.analyze_surface(points)

    assert report.arbitrage_type == SurfaceArbitrageType.NEGATIVE_FORWARD_VARIANCE
    assert len(report.calendar_arbitrage_opportunities) > 0
    best_arb = report.calendar_arbitrage_opportunities[0]
    assert best_arb.forward_variance < 0.0
    assert best_arb.is_arbitrage is True
    assert "CALENDAR SPREAD ARBITRAGE DETECTED" in report.tactical_directive


def test_butterfly_convexity_violation(sieve: OptionsForwardJumpPDESieve):
    spot = 25000.0
    t = 0.10
    # Create extreme non-convexity (sharp IV spike at middle strike violating Breeden-Litzenberger)
    points = [
        VolSurfacePoint(strike=24500.0, expiry_years=t, implied_vol=0.12, underlying_spot=spot),
        VolSurfacePoint(strike=25000.0, expiry_years=t, implied_vol=0.35, underlying_spot=spot),
        VolSurfacePoint(strike=25500.0, expiry_years=t, implied_vol=0.12, underlying_spot=spot),
    ]

    report = sieve.analyze_surface(points)
    assert report.arbitrage_type == SurfaceArbitrageType.BUTTERFLY_CONVEXITY_VIOLATION
    assert len(report.butterfly_arbitrage_strikes) > 0
    assert 25000.0 in report.butterfly_arbitrage_strikes


def test_crash_jump_tail_explosion(sieve: OptionsForwardJumpPDESieve):
    spot = 25000.0
    t = 0.20
    # Smooth convex crash put skew: steep monotonic curve without concave kinks
    strikes = [20000.0, 21500.0, 23000.0, 24000.0, 25000.0, 26000.0]
    points = [
        VolSurfacePoint(
            strike=k,
            expiry_years=t,
            implied_vol=round(0.14 + 1.20 * (max(0.0, (spot - k) / spot) ** 1.3), 4),
            underlying_spot=spot,
        )
        for k in strikes
    ]

    report = sieve.analyze_surface(points)
    assert report.jump_regime == JumpTailRegime.ACUTE_CRASH_HAZARD
    assert report.inferred_jump_intensity_lambda > 0.80
    assert report.left_tail_decay_eta2 < 3.5
    assert len(report.butterfly_arbitrage_strikes) == 0
    assert report.arbitrage_type == SurfaceArbitrageType.CRASH_JUMP_TAIL_EXPLOSION
    assert "ACUTE DOWNSIDE CRASH HAZARD" in report.tactical_directive
