"""
Unit Test Suite for Domain 258: Cross-Venue Foreign Exchange Tri-Currency Convexity & Covered Interest Parity Basis Sentry
"""

import pytest
from services.fx_cip_basis_sentry import (
    FXCIPBasisSentry,
    CIPTelemetrySnapshot,
    FXArbitrageRegime,
    FXTradingDirective,
)


@pytest.fixture
def sentry():
    return FXCIPBasisSentry(
        min_arb_edge_bps=8.0,
        dollar_squeeze_threshold_bps=-80.0,
    )


def test_nominal_cip_equilibrium(sentry):
    # Spot = 1.0800, r_d = 5.0%, r_f = 3.5%, tau = 0.25 (3M)
    # Theoretical F = 1.0800 * (1 + 0.05 * 0.25) / (1 + 0.035 * 0.25)
    # F = 1.0800 * 1.0125 / 1.00875 = 1.084015
    spot = 1.0800
    r_d = 0.05
    r_f = 0.035
    tau = 0.25
    forward = spot * (1.0 + r_d * tau) / (1.0 + r_f * tau)

    snap = CIPTelemetrySnapshot(
        currency_pair="EUR/USD",
        spot_rate=spot,
        forward_rate=forward,
        domestic_rate=r_d,
        foreign_rate=r_f,
        tenor_years=tau,
        cross_triangular_discrepancy_bps=0.0,
    )
    res = sentry.evaluate(snap)
    assert res.regime == FXArbitrageRegime.NOMINAL_CIP_EQUILIBRIUM
    assert res.directive == FXTradingDirective.MONITOR_EQUILIBRIUM
    assert abs(res.implied_cip_basis_bps) < 0.5


def test_cip_basis_arbitrage_active(sentry):
    # Forward is mispriced (too high), implying negative basis of -25 bps
    spot = 1.0800
    r_d = 0.05
    r_f = 0.035
    tau = 0.25
    # Forward priced under r_f + x where x = -0.0025 (-25 bps)
    # F = S * (1 + r_d * tau) / (1 + (r_f - 0.0025) * tau)
    forward = spot * (1.0 + r_d * tau) / (1.0 + (r_f - 0.0025) * tau)

    snap = CIPTelemetrySnapshot(
        currency_pair="EUR/USD",
        spot_rate=spot,
        forward_rate=forward,
        domestic_rate=r_d,
        foreign_rate=r_f,
        tenor_years=tau,
        execution_friction_bps=2.5,
    )
    res = sentry.evaluate(snap)
    assert res.regime == FXArbitrageRegime.CIP_BASIS_ARBITRAGE_ACTIVE
    assert res.directive == FXTradingDirective.EXECUTE_COVERED_SYNTHETIC_CARRY
    assert res.implied_cip_basis_bps == pytest.approx(-25.0, abs=1.0)
    assert res.net_annualized_edge_bps > 15.0


def test_triangular_cross_dislocation(sentry):
    # Basis is near zero, but triangular cross discrepancy is 6.5 bps
    snap = CIPTelemetrySnapshot(
        currency_pair="USD/JPY",
        spot_rate=150.0,
        forward_rate=148.5,
        domestic_rate=0.05,
        foreign_rate=0.01,
        tenor_years=0.25,
        cross_triangular_discrepancy_bps=6.5,
        execution_friction_bps=1.5,
    )
    res = sentry.evaluate(snap)
    assert res.regime in [
        FXArbitrageRegime.TRIANGULAR_CROSS_DISLOCATION,
        FXArbitrageRegime.CIP_BASIS_ARBITRAGE_ACTIVE,
    ]
    if res.regime == FXArbitrageRegime.TRIANGULAR_CROSS_DISLOCATION:
        assert res.directive == FXTradingDirective.EXECUTE_TRIANGULAR_CROSS_ARB


def test_extreme_dollar_liquidity_squeeze(sentry):
    # Massive negative basis of -120 bps (acute crisis liquidity shortage)
    spot = 1.0800
    r_d = 0.05
    r_f = 0.035
    tau = 0.25
    forward = spot * (1.0 + r_d * tau) / (1.0 + (r_f - 0.0120) * tau)

    snap = CIPTelemetrySnapshot(
        currency_pair="EUR/USD",
        spot_rate=spot,
        forward_rate=forward,
        domestic_rate=r_d,
        foreign_rate=r_f,
        tenor_years=tau,
    )
    res = sentry.evaluate(snap)
    assert res.regime == FXArbitrageRegime.EXTREME_DOLLAR_LIQUIDITY_SQUEEZE
    assert res.directive == FXTradingDirective.TRIGGER_COLLATERAL_DEFENSE
    assert res.implied_cip_basis_bps <= -80.0
