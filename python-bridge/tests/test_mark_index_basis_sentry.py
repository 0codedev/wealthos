"""
Unit tests for Domain 269 / WP-FO: Mark-Index Basis Convergence & Dislocation Sentry
"""

import pytest
from services.mark_index_basis_sentry import (
    MarkIndexBasisSentry,
    SpotConstituentFeed,
    MarkBasisRegime,
    MarkBasisDirective,
)


@pytest.fixture
def sentry():
    return MarkIndexBasisSentry(
        phantom_mark_depeg_hurdle_bps=40.0,
        convergence_arb_hurdle_bps=25.0,
        constituent_outlier_threshold_bps=150.0,
        z_score_hurdle=2.0,
    )


def test_equilibrium_tight_convergence(sentry):
    constituents = [
        SpotConstituentFeed("Binance", 100.0, 0.4),
        SpotConstituentFeed("Coinbase", 100.02, 0.4),
        SpotConstituentFeed("Kraken", 99.98, 0.2),
    ]
    res = sentry.evaluate_mark_basis(
        symbol="BTCUSDT",
        contract_last_price=100.01,
        mark_price=100.01,
        constituents=constituents,
    )
    assert res.regime == MarkBasisRegime.EQUILIBRIUM_TIGHT_CONVERGENCE
    assert res.directive == MarkBasisDirective.MAINTAIN_NORMAL_TRADING
    assert abs(res.mark_to_index_basis_bps) < 5.0
    assert abs(res.last_to_mark_basis_bps) < 5.0


def test_artificial_mark_depeg_liquidation_hazard(sentry):
    # Contract is at 100.0, but Mark price is artificially pushed to 100.60 (+60 bps dislocation)
    constituents = [
        SpotConstituentFeed("Binance", 100.0, 0.5),
        SpotConstituentFeed("Coinbase", 100.0, 0.5),
    ]
    res = sentry.evaluate_mark_basis(
        symbol="ETHUSDT",
        contract_last_price=100.0,
        mark_price=100.60,
        constituents=constituents,
    )
    assert res.regime == MarkBasisRegime.ARTIFICIAL_MARK_DEPEG_LIQUIDATION_HAZARD
    assert res.directive == MarkBasisDirective.INJECT_EMERGENCY_MARGIN_PULL_RESTING
    assert abs(res.last_to_mark_basis_bps) >= 40.0


def test_index_constituent_dislocation_anomaly(sentry):
    # Kraken flash crashed to 95.0 (-500 bps deviation from median 100.0)
    constituents = [
        SpotConstituentFeed("Binance", 100.0, 0.4),
        SpotConstituentFeed("Coinbase", 100.0, 0.4),
        SpotConstituentFeed("Kraken", 95.0, 0.2),
    ]
    res = sentry.evaluate_mark_basis(
        symbol="SOLUSDT",
        contract_last_price=100.02,
        mark_price=100.02,
        constituents=constituents,
    )
    assert res.regime == MarkBasisRegime.INDEX_CONSTITUENT_DISLOCATION_ANOMALY
    assert res.directive == MarkBasisDirective.RECALCULATE_SYNTHETIC_INDEX_FILTER_OUTLIER
    assert "Kraken" in res.outlier_venues
    assert res.clean_index_price == 100.0  # Kraken rejected from calculation


def test_mark_index_convergence_arbitrage(sentry):
    # Mark is at 100.35, clean index is at 100.00 (+35 bps basis)
    constituents = [
        SpotConstituentFeed("Binance", 100.0, 0.5),
        SpotConstituentFeed("Coinbase", 100.0, 0.5),
    ]
    # Historical basis mean=0, std=10 bps -> 35 bps gives z-score 3.5
    hist = [0.0] * 20
    res = sentry.evaluate_mark_basis(
        symbol="AVAXUSDT",
        contract_last_price=100.34,
        mark_price=100.35,
        constituents=constituents,
        historical_basis_bps_series=hist,
    )
    assert res.regime == MarkBasisRegime.MARK_INDEX_CONVERGENCE_ARBITRAGE
    assert res.directive == MarkBasisDirective.EXECUTE_BASIS_CONVERGENCE_CAPTURE
    assert res.mark_to_index_basis_bps >= 25.0
    assert res.basis_z_score >= 2.0
