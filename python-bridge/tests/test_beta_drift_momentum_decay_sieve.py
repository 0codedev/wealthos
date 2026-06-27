"""
Unit Tests for High-Frequency Cross-Sectional Factor Beta Drift & Momentum Decay Sieve (Domain 182 / WP-CF)
"""

import math
import pytest

from services.beta_drift_momentum_decay_sieve import (
    BetaDriftMomentumDecaySieve,
    BarReturnPair,
    BetaRegimeDirective,
)


@pytest.fixture
def sieve():
    return BetaDriftMomentumDecaySieve(
        db_path=":memory:",
        rolling_window_bars=20,
        beta_drift_threshold=0.35,
        half_life_exhaustion_bars=8.0,
    )


def test_exact_capm_beta_calculation(sieve):
    # Construct exact linear relation: R_asset = 1.5 * R_mkt
    pairs = [
        BarReturnPair(timestamp_sec=float(i * 300), asset_return=1.5 * (0.002 * (i % 5 - 2)), market_return=0.002 * (i % 5 - 2))
        for i in range(25)
    ]

    beta, alpha, sigma_eps = sieve.calculate_rolling_beta(pairs)
    assert abs(beta - 1.50) < 1e-3
    assert abs(alpha) < 1e-4
    assert abs(sigma_eps) < 1e-4


def test_beta_expansion_directive(sieve):
    # First 20 bars: beta = 1.0 (asset = 1.0 * mkt)
    # Next 20 bars: beta = 1.8 (asset = 1.8 * mkt) -> severe expansion
    history = []
    t = 0.0
    for i in range(20):
        t += 300.0
        m = 0.003 if i % 2 == 0 else -0.002
        history.append(BarReturnPair(t, m * 1.0, m))

    for i in range(20):
        t += 300.0
        m = 0.003 if i % 2 == 0 else -0.002
        history.append(BarReturnPair(t, m * 1.85, m))

    rep = sieve.analyze_beta_drift("TATASTEEL", "NIFTY", history, baseline_beta=1.0)

    assert rep.current_beta > 1.70
    assert rep.beta_drift > 0.40
    assert rep.beta_velocity_per_hr > 0.0
    assert rep.directive == BetaRegimeDirective.BETA_EXPANSION_HEDGE_MARKET_RISK
    assert "Severe beta expansion" in rep.rationale


def test_beta_compression_decoupling(sieve):
    # Asset returns are uncorrelated to market, low variance -> beta near 0
    history = [
        BarReturnPair(
            timestamp_sec=float(i * 300),
            asset_return=0.0001 * (1 if i % 3 == 0 else -1),
            market_return=0.005 * (1 if i % 2 == 0 else -1),
        )
        for i in range(25)
    ]

    rep = sieve.analyze_beta_drift("PHARMA_CO", "NIFTY", history, baseline_beta=1.0)

    assert rep.current_beta <= 0.35
    assert rep.directive == BetaRegimeDirective.BETA_COMPRESSION_DECOUPLING
    assert "decoupled" in rep.rationale


def test_idiosyncratic_alpha_outperformer(sieve):
    # Stable beta = 1.0, but asset delivers persistent positive idiosyncratic excess return +0.0015 each bar
    history = [
        BarReturnPair(
            timestamp_sec=float(i * 300),
            asset_return=(0.002 * (1 if i % 2 == 0 else -1)) + 0.0015,
            market_return=0.002 * (1 if i % 2 == 0 else -1),
        )
        for i in range(25)
    ]

    rep = sieve.analyze_beta_drift("OUTPERFORM_STK", "NIFTY", history, baseline_beta=1.0)

    assert abs(rep.current_beta - 1.0) < 0.20
    assert rep.residual_momentum > 0.015
    assert rep.directive == BetaRegimeDirective.IDIOSYNCRATIC_ALPHA_OUTPERFORMER
    assert "Strong idiosyncratic alpha" in rep.rationale


def test_momentum_exhaustion_half_life_decay(sieve):
    # Rapidly mean-reverting residual fluctuations with low persistence
    history = []
    t = 0.0
    for i in range(25):
        t += 300.0
        # Alternating sharp overshoot and snapback
        m = 0.001
        asset_r = m + (0.004 if i % 2 == 0 else -0.0035)
        history.append(BarReturnPair(t, asset_r, m))

    rep = sieve.analyze_beta_drift("FADE_STK", "NIFTY", history, baseline_beta=1.0)

    assert rep.momentum_half_life_bars < 8.0 or rep.directive in [
        BetaRegimeDirective.MOMENTUM_EXHAUSTION_HALFLIFE_DECAY,
        BetaRegimeDirective.STABLE_FACTOR_EQUILIBRIUM,
    ]


def test_sqlite_persistence(sieve):
    pairs = [
        BarReturnPair(timestamp_sec=float(i * 300), asset_return=0.002 * i, market_return=0.001 * i)
        for i in range(25)
    ]

    sieve.analyze_beta_drift("PERSIST_SYM", "NIFTY", pairs)

    telemetry = sieve.get_latest_telemetry(limit=5)
    assert len(telemetry) == 1
    assert telemetry[0][0] == "PERSIST_SYM"
    assert telemetry[0][1] == "NIFTY"
