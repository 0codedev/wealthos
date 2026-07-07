"""
Unit Tests for Cross-Asset Order Flow Toxicity & Toxic Imbalance Spillover Engine (Domain 125 / WP-AA)
"""

from datetime import datetime
import random
import pytest

from services.toxic_spillover_engine import (
    ToxicSpilloverEngine,
    DirectionalSpilloverMetrics,
    SystemicContagionAlert,
)


@pytest.fixture
def spillover_engine():
    return ToxicSpilloverEngine(
        contagion_threshold_pct=40.0,
        moderate_threshold_pct=25.0,
        forecast_horizon_h=4,
        db_path=":memory:",
    )


def test_var1_matrix_fitting(spillover_engine):
    # Simulated 20 observations for 3 assets
    random.seed(42)
    data = [[random.uniform(0.1, 0.5) for _ in range(3)] for _ in range(25)]

    phi, sigma = spillover_engine.fit_var1_matrix(data)
    assert len(phi) == 3
    assert len(phi[0]) == 3
    assert len(sigma) == 3
    assert len(sigma[0]) == 3
    # Diagonal variances are positive
    for i in range(3):
        assert sigma[i][i] > 0.0


def test_gfevd_matrix_row_normalization(spillover_engine):
    random.seed(101)
    data = [[random.uniform(0.1, 0.6) for _ in range(3)] for _ in range(30)]

    phi, sigma = spillover_engine.fit_var1_matrix(data)
    gfevd = spillover_engine.compute_gfevd_matrix(phi, sigma, h_steps=4)

    assert len(gfevd) == 3
    for i in range(3):
        row_sum = sum(gfevd[i])
        # Each row must sum to 1.0 (100% of forecast error variance)
        assert abs(row_sum - 1.0) < 1e-4


def test_spillover_transmitter_vs_receiver(spillover_engine):
    # NIFTY is leading transmitter; RELIANCE and HDFC lag and absorb NIFTY toxicity
    random.seed(99)
    t_len = 60
    nifty_vpin = [0.25]
    for _ in range(t_len - 1):
        nifty_vpin.append(0.3 * nifty_vpin[-1] + random.uniform(-0.05, 0.05) + (0.25 if random.random() < 0.25 else 0.0))
    # Reliance and HDFC strictly lag NIFTY
    reliance_vpin = [0.20] + [0.8 * nifty_vpin[t] + random.uniform(-0.01, 0.01) for t in range(t_len - 1)]
    hdfc_vpin = [0.20] + [0.8 * nifty_vpin[t] + random.uniform(-0.01, 0.01) for t in range(t_len - 1)]

    vpin_data = [[nifty_vpin[t], reliance_vpin[t], hdfc_vpin[t]] for t in range(t_len)]
    symbols = ["NIFTY", "RELIANCE", "HDFCBANK"]
    now = datetime(2026, 10, 18, 13, 0, 0)

    alert = spillover_engine.assess_spillover_risk(symbols, vpin_data, now)

    assert alert.total_spillover_index > 0.0
    # NIFTY should be a net transmitter
    nifty_metrics = alert.directional_metrics["NIFTY"]
    assert nifty_metrics.is_net_transmitter is True
    assert nifty_metrics.net_spillover > 0.0
    assert alert.lead_transmitter_symbol == "NIFTY"


def test_systemic_contagion_alert_trigger(spillover_engine):
    # Tightly coupled, synchronized toxic surge across all 3 assets
    t_len = 35
    vpin_data = [[0.10 + 0.02 * t, 0.12 + 0.02 * t, 0.11 + 0.02 * t] for t in range(t_len)]
    symbols = ["NIFTY", "BANKNIFTY", "FINNIFTY"]
    now = datetime(2026, 10, 18, 13, 15, 0)

    alert = spillover_engine.assess_spillover_risk(symbols, vpin_data, now)

    # Cross-spillover is strong
    assert alert.total_spillover_index >= 40.0
    assert alert.regime == "SYSTEMIC_CONTAGION"
    assert alert.is_contagion_alert_active is True
    assert "WIDEN_MAKER_SPREADS" in alert.recommended_portfolio_action


def test_low_spillover_idiosyncratic_regime(spillover_engine):
    # Completely uncorrelated, independent random noise
    random.seed(777)
    t_len = 50
    vpin_data = [[random.uniform(0.1, 0.3) for _ in range(3)] for _ in range(t_len)]
    symbols = ["STOCK_A", "STOCK_B", "STOCK_C"]
    now = datetime(2026, 10, 18, 13, 20, 0)

    alert = spillover_engine.assess_spillover_risk(symbols, vpin_data, now)

    # Spillover remains low/moderate
    assert not alert.is_contagion_alert_active


def test_empty_or_short_series_graceful_handling(spillover_engine):
    now = datetime(2026, 10, 18, 13, 25, 0)
    # Less than 5 observations
    short_data = [[0.1, 0.2], [0.15, 0.25]]
    alert = spillover_engine.assess_spillover_risk(["A", "B"], short_data, now)

    assert alert.total_spillover_index == 0.0
    assert alert.regime == "IDIOSYNCRATIC_ISOLATED"
    assert not alert.is_contagion_alert_active


def test_sqlite_persistence(spillover_engine):
    now = datetime(2026, 10, 18, 13, 30, 0)
    data = [[0.2, 0.3], [0.25, 0.35], [0.3, 0.4], [0.35, 0.45], [0.4, 0.5], [0.45, 0.55]]
    symbols = ["NIFTY", "BANKNIFTY"]

    spillover_engine.assess_spillover_risk(symbols, data, now)

    conn = spillover_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT total_spillover, regime, lead_transmitter FROM toxic_spillover_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] >= 0.0
    assert row[2] in symbols
