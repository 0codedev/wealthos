"""
Unit Tests for Real-Time Intraday Flow Toxicity & Adverse Selection Slippage Sieve (Domain 187 / WP-CK)
"""

import pytest

from services.adverse_selection_slippage_sieve import (
    AdverseSelectionSlippageSieve,
    TradeExecutionTrace,
    AdverseSelectionDirective,
)


@pytest.fixture
def sieve():
    return AdverseSelectionSlippageSieve(
        db_path=":memory:",
        toxicity_veto_threshold=0.70,
        toxicity_benign_threshold=0.35,
    )


def test_exact_spread_decomposition_identity(sieve):
    # Buy trade at 25002.0, Mid at 25000.0, Mid post-horizon at 25003.0
    trace = TradeExecutionTrace(
        timestamp_sec=100.0,
        trade_price=25002.0,
        mid_at_execution=25000.0,
        mid_post_horizon=25003.0,
        direction=1,  # BUY
        quantity=100.0,
    )

    eff, real, imp = sieve.evaluate_spread_decomposition(trace)

    # Eff = 2 * 1 * (25002 - 25000) / 25000 * 10000 = 4 / 25000 * 10000 = 1.60 bps
    # Real = 2 * 1 * (25002 - 25003) / 25000 * 10000 = -2 / 25000 * 10000 = -0.80 bps
    # Impact = 2 * 1 * (25003 - 25000) / 25000 * 10000 = 6 / 25000 * 10000 = 2.40 bps
    assert abs(eff - 1.60) < 1e-2
    assert abs(real - (-0.80)) < 1e-2
    assert abs(imp - 2.40) < 1e-2
    # Mathematical Identity: Eff == Real + Impact
    assert abs(eff - (real + imp)) < 1e-4


def test_severe_adverse_selection_veto(sieve):
    # Aggressive informed sweeps: buyers hit ask, price moves up sharply afterward (negative realized spread for maker)
    traces = [
        TradeExecutionTrace(
            timestamp_sec=float(i),
            trade_price=100.05,
            mid_at_execution=100.00,
            mid_post_horizon=100.12,  # Drifted +12 bps in direction of buyer
            direction=1,
            quantity=500.0,
        )
        for i in range(10)
    ]

    rep = sieve.analyze_flow_toxicity("NIFTY_FUT", traces)

    assert rep.realized_spread_bps < 0.0
    assert rep.toxicity_ratio >= 0.70
    assert rep.quote_spread_multiplier >= 1.80
    assert rep.directive == AdverseSelectionDirective.DEFENSIVE_SPREAD_WIDENING_VETO_PASSIVE
    assert "Severe adverse selection" in rep.rationale


def test_benign_retail_uninformed_flow(sieve):
    # Uninformed noise flow: trades cross half-spread, but price immediately mean-reverts or stays flat
    traces = [
        TradeExecutionTrace(
            timestamp_sec=float(i),
            trade_price=100.05 if i % 2 == 0 else 99.95,
            mid_at_execution=100.00,
            mid_post_horizon=100.00,  # Mid does not move! Realized spread is captured 100% by maker
            direction=1 if i % 2 == 0 else -1,
            quantity=200.0,
        )
        for i in range(10)
    ]

    rep = sieve.analyze_flow_toxicity("RELIANCE", traces)

    assert rep.realized_spread_bps > 0.0
    assert rep.toxicity_ratio <= 0.35
    assert rep.quote_spread_multiplier <= 0.90
    assert rep.directive == AdverseSelectionDirective.BENIGN_RETAIL_FLOW_TIGHTEN_QUOTES
    assert "Benign uninformed" in rep.rationale


def test_sqlite_persistence(sieve):
    trace = TradeExecutionTrace(10.0, 100.05, 100.00, 100.02, 1, 100.0)
    sieve.analyze_flow_toxicity("PERSIST_ADV", [trace])

    telemetry = sieve.get_latest_telemetry(limit=5)
    assert len(telemetry) == 1
    assert telemetry[0][0] == "PERSIST_ADV"
    assert telemetry[0][1] > 0.0
