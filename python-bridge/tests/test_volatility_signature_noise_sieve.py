"""
Unit Tests for Intraday Realized Volatility Signature Plot & Microstructure Noise Sieve
Domain 225 / Work Package WP-DW
"""

import pytest
import math
import random
from services.volatility_signature_noise_sieve import (
    VolatilitySignatureNoiseSieve,
    NoiseRegimeState,
)


def generate_noisy_ticks(
    n_ticks: int = 1000,
    dt_sec: float = 1.0,
    daily_vol: float = 0.20,
    noise_std: float = 0.0005,
    seed: int = 42,
):
    random.seed(seed)
    # sigma per second
    sigma_sec = daily_vol / math.sqrt(252 * 6.5 * 3600)
    p0 = 100.0

    prices = []
    timestamps = []
    curr_p = p0
    curr_t = 0.0

    for i in range(n_ticks):
        # Brownian innovation
        ret = random.gauss(0.0, sigma_sec * math.sqrt(dt_sec))
        curr_p *= math.exp(ret)
        curr_t += dt_sec

        # Add bid-ask bounce noise
        noise = random.gauss(0.0, noise_std)
        observed_p = curr_p * (1.0 + noise)

        prices.append(observed_p)
        timestamps.append(curr_t)

    return prices, timestamps


def test_rv_computation_basic():
    sieve = VolatilitySignatureNoiseSieve()
    prices = [100.0, 101.0, 102.0, 101.0, 103.0]
    timestamps = [0.0, 10.0, 20.0, 30.0, 40.0]

    pt = sieve.compute_rv(prices, timestamps, interval_seconds=10.0)
    assert pt.tau_seconds == 10.0
    assert pt.realized_variance > 0.0
    assert pt.num_samples == 4
    assert pt.annualized_volatility > 0.0


def test_signature_plot_decay():
    """
    With microstructure noise present, short tau intervals should exhibit elevated RV
    compared to longer tau intervals (signature plot effect).
    """
    sieve = VolatilitySignatureNoiseSieve()
    prices, timestamps = generate_noisy_ticks(n_ticks=1200, dt_sec=1.0, daily_vol=0.15, noise_std=0.001)

    sig_points = sieve.compute_signature_plot(prices, timestamps, tau_grid_seconds=[1.0, 10.0, 60.0])
    assert len(sig_points) == 3

    rv_1s = sig_points[0].realized_variance
    rv_60s = sig_points[2].realized_variance

    # Due to noise variance 2 * n * omega^2, RV at 1s should be substantially higher than at 60s
    assert rv_1s > rv_60s


def test_tsrv_noise_correction():
    sieve = VolatilitySignatureNoiseSieve(subgrid_k=5)
    prices, timestamps = generate_noisy_ticks(n_ticks=800, dt_sec=1.0, daily_vol=0.20, noise_std=0.0008)

    result = sieve.compute_tsrv(prices, timestamps, k=5)
    assert result.tsrv_variance > 0.0
    assert result.noise_variance_omega2 > 0.0
    # All-points RV includes noise, so all-points RV should exceed TSRV variance
    assert result.all_points_variance > result.tsrv_variance
    assert result.optimal_sampling_sec > 1.0


def test_clean_signal_regime():
    sieve = VolatilitySignatureNoiseSieve()
    # Pure Brownian motion without microstructure noise
    prices, timestamps = generate_noisy_ticks(n_ticks=500, dt_sec=2.0, daily_vol=0.25, noise_std=0.0)

    result = sieve.compute_tsrv(prices, timestamps, k=4)
    assert result.tsrv_variance > 0.0
    assert result.regime in [NoiseRegimeState.SIGNAL_CLEAR, NoiseRegimeState.MODERATE_NOISE]


def test_noise_dominated_regime():
    sieve = VolatilitySignatureNoiseSieve()
    # Low fundamental volatility, high bid-ask bounce
    prices, timestamps = generate_noisy_ticks(n_ticks=1000, dt_sec=1.0, daily_vol=0.02, noise_std=0.003)

    result = sieve.compute_tsrv(prices, timestamps, k=6)
    assert result.regime == NoiseRegimeState.NOISE_DOMINATED
    assert result.noise_to_signal_ratio > 0.40
