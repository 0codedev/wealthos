"""
Unit Tests for Multi-Resolution Wavelet Denoising & Transient Trend Sieve (Domain 136 / WP-AL)
"""

import math
from datetime import datetime
import pytest

from services.wavelet_transient_trend_sieve import (
    WaveletTransientTrendSieve,
    WaveletSieveResult,
)


@pytest.fixture
def wavelet_sieve():
    return WaveletTransientTrendSieve(
        transient_shock_sigma_multiplier=3.0,
        trend_slope_threshold_bps=4.0,
        db_path=":memory:",
    )


def test_haar_forward_inverse_exact_reconstruction(wavelet_sieve):
    signal = [100.5, 102.3, 99.8, 105.1, 103.4, 104.9]
    approx, detail = wavelet_sieve.haar_forward(signal)
    reconstructed = wavelet_sieve.haar_inverse(approx, detail, len(signal))

    assert len(reconstructed) == len(signal)
    for orig, rec in zip(signal, reconstructed):
        assert abs(orig - rec) < 1e-10


def test_estimate_mad_sigma(wavelet_sieve):
    import random
    rng = random.Random(42)
    # Generate Gaussian noise with target sigma = 3.0
    noise = [rng.gauss(0.0, 3.0) for _ in range(200)]
    sigma_est = wavelet_sieve.estimate_mad_sigma(noise)
    assert 2.4 <= sigma_est <= 3.6


def test_transient_shock_fade_regime(wavelet_sieve):
    import random
    rng = random.Random(10)
    # 40 bars of flat sideways trading with small noise
    prices = [25000.0 + rng.gauss(0.0, 1.5) for _ in range(40)]
    # Final bar: sudden +120 pt flash spike (transient illiquid wick)
    prices.append(25120.0)

    res = wavelet_sieve.process_price_series(prices)
    assert res.is_transient_shock is True
    assert res.regime == "TRANSIENT_NOISE_FADE"
    assert res.execution_recommendation == "FADE_OVERBOUGHT_SPIKE_SELL"
    assert res.residual_noise > 0.0
    assert "FADE_OVERBOUGHT_SPIKE_SELL" in res.execution_recommendation


def test_structural_bull_trend_regime(wavelet_sieve):
    import random
    rng = random.Random(25)
    # Steady climbing trend (+15 pts per bar with low noise)
    prices = [25000.0 + 15.0 * i + rng.gauss(0.0, 1.0) for i in range(30)]

    res = wavelet_sieve.process_price_series(prices)
    assert res.is_transient_shock is False
    assert res.regime == "STRUCTURAL_TREND_BULL"
    assert res.trend_slope_bps >= 4.0
    assert res.execution_recommendation == "TREND_FOLLOW_LONG"


def test_sqlite_persistence(wavelet_sieve):
    prices = [25000.0, 25005.0, 25010.0, 25015.0, 25020.0]
    wavelet_sieve.process_price_series(prices)

    conn = wavelet_sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT raw_price, regime, recommendation FROM wavelet_trend_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == 25020.0
