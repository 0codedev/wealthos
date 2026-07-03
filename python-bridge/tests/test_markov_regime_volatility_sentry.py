"""
Unit tests for Domain 167 (WP-BQ): Machine-Learned Regime Switching Markov Gaussian Mixture Volatility Sentry
"""

import pytest
from services.markov_regime_volatility_sentry import (
    MarkovRegimeVolatilitySentry,
    RegimeParameters,
    MarkovSentryReport,
)


def test_gaussian_pdf():
    sentry = MarkovRegimeVolatilitySentry()
    p_center = sentry.gaussian_pdf(0.0006, mu=0.0006, sigma=0.007)
    p_tail = sentry.gaussian_pdf(0.05, mu=0.0006, sigma=0.007)
    assert p_center > p_tail
    assert p_tail > 0.0
    # Extreme tail underflow guard
    p_extreme = sentry.gaussian_pdf(10.0, mu=0.0, sigma=0.01)
    assert p_extreme > 0.0


def test_forward_filtering_low_vol():
    sentry = MarkovRegimeVolatilitySentry()
    # 20 consecutive days of mild, positive low-volatility returns
    low_vol_returns = [0.0005, 0.0006, 0.0004, 0.0007, 0.0005] * 4
    filtered = sentry.filter_probabilities(low_vol_returns)
    assert len(filtered) == len(low_vol_returns)

    latest_probs = filtered[-1]
    assert len(latest_probs) == 3
    assert abs(sum(latest_probs) - 1.0) < 1e-4
    # State 0 (Low Vol) should dominate
    assert latest_probs[0] > 0.70
    assert latest_probs[2] < 0.05


def test_forward_filtering_crisis_jump():
    sentry = MarkovRegimeVolatilitySentry()
    # 5 consecutive days of catastrophic market crash (-3% to -5% per day)
    crash_returns = [-0.035, -0.042, -0.051, -0.038, -0.045]
    filtered = sentry.filter_probabilities(crash_returns)

    latest_probs = filtered[-1]
    # State 2 (Crisis Shock) should dominate
    assert latest_probs[2] > 0.80
    assert latest_probs[0] < 0.01


def test_viterbi_decoding_transition():
    sentry = MarkovRegimeVolatilitySentry()
    # Regime 0 (10 days low vol) -> Regime 2 (4 days crash) -> Regime 1 (6 days choppy)
    seq = (
        [0.0006] * 10
        + [-0.045] * 4
        + [0.015, -0.012, 0.014, -0.015, 0.010, -0.011]
    )
    path = sentry.viterbi_decode(seq)
    assert len(path) == len(seq)
    # Start in state 0
    assert path[0] == 0
    # Middle in state 2 (crisis)
    assert path[11] == 2
    # End in state 1 (choppy/moderate)
    assert path[-1] == 1


def test_analyze_regime_and_leverage_governor():
    sentry = MarkovRegimeVolatilitySentry(base_leverage=1.50)

    # 1. Bullish low vol environment
    bull_returns = [0.0006, 0.0007, 0.0005, 0.0006, 0.0008] * 3
    rep_bull = sentry.analyze_regime("NIFTY", bull_returns)
    assert rep_bull.active_state == 0
    assert rep_bull.recommended_leverage >= 1.40
    assert rep_bull.regime_directive == "BULL_EXPANSION_MAX_LEVERAGE"
    assert rep_bull.crash_jump_hazard < 0.10

    # 2. Crash panic environment
    crash_returns = [-0.035, -0.045, -0.040, -0.055]
    rep_crash = sentry.analyze_regime("NIFTY", crash_returns)
    assert rep_crash.active_state == 2
    assert rep_crash.recommended_leverage == 0.0  # Max deleveraging
    assert rep_crash.regime_directive == "SYSTEMIC_CRASH_DELEVERAGING_LONG_VOLATILITY"
    assert rep_crash.crash_jump_hazard > 0.80


def test_sqlite_persistence():
    sentry = MarkovRegimeVolatilitySentry(db_path=":memory:")
    sample_returns = [0.0005, 0.0006, -0.0002, 0.0008]
    rep = sentry.analyze_regime("BANKNIFTY", sample_returns)
    assert rep.symbol == "BANKNIFTY"

    rows = sentry.get_latest_telemetry(5)
    assert len(rows) == 1
    assert rows[0][0] == "BANKNIFTY"
    assert rows[0][2] == rep.active_state
