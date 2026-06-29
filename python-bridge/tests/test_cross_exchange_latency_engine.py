"""
Unit Tests for Cross-Exchange Latency Arbitrage & Lead-Lag Microstructure Engine (Domain 122 / WP-X)
"""

from datetime import datetime
import pytest

from services.cross_exchange_latency_engine import (
    CrossExchangeLatencyEngine,
    DualExchangeTick,
    LeadLagMetrics,
    LatencyArbSignal,
)


@pytest.fixture
def latency_engine():
    return CrossExchangeLatencyEngine(
        min_net_hurdle_bps=3.0,
        statutory_friction_bps=4.8,
        max_position_shares=500,
        default_ttl_ms=250,
        db_path=":memory:",
    )


def test_lead_lag_ccf_nse_leads(latency_engine):
    # Simulated returns where BSE lags NSE by 2 periods
    nse_rets = [0.01, -0.02, 0.03, -0.01, 0.02, 0.04, -0.03, 0.01, -0.02, 0.03, 0.01, -0.01, 0.02, -0.02, 0.03]
    # BSE has same signal shifted by 2
    bse_rets = [0.00, 0.00] + nse_rets[:-2]

    metrics = latency_engine.analyze_lead_lag("RELIANCE", nse_rets, bse_rets, time_step_ms=50)

    assert metrics.optimal_lag_ms == 100  # 2 steps * 50ms = 100ms lead
    assert metrics.regime == "NSE_DOMINANT_LEAD"
    assert metrics.peak_cross_correlation > 0.80


def test_lead_lag_ccf_bse_leads(latency_engine):
    # Simulated returns where NSE lags BSE by 2 periods
    bse_rets = [0.01, -0.02, 0.03, -0.01, 0.02, 0.04, -0.03, 0.01, -0.02, 0.03, 0.01, -0.01, 0.02, -0.02, 0.03]
    nse_rets = [0.00, 0.00] + bse_rets[:-2]

    metrics = latency_engine.analyze_lead_lag("TCS", nse_rets, bse_rets, time_step_ms=50)

    assert metrics.optimal_lag_ms == -100  # -2 steps * 50ms = -100ms
    assert metrics.regime == "BSE_TRANSIENT_LEAD"
    assert metrics.peak_cross_correlation > 0.80


def test_information_shares_estimation(latency_engine):
    # Active, tight NSE returns with lower noise, noisy BSE returns
    nse_rets = [0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.02, -0.02] * 4
    bse_rets = [0.012, -0.008, 0.025, -0.018, 0.011, -0.013, 0.022, -0.019] * 4

    is_n, is_b = latency_engine.estimate_information_shares(nse_rets, bse_rets)
    assert is_n > 0.50
    assert abs((is_n + is_b) - 1.0) < 1e-4


def test_arbitrage_nse_buy_bse_sell_actionable(latency_engine):
    now = datetime(2026, 10, 18, 11, 45, 0)

    # RELIANCE: NSE Ask is 2998.00; BSE Bid is 3002.00
    # Gross spread = (3002 - 2998) / 2998 * 10000 = ~13.34 bps
    # Friction = 4.8 bps; Net spread = ~8.54 bps >= 3.0 bps hurdle
    tick = DualExchangeTick(
        symbol="RELIANCE",
        nse_bid=2997.50,
        nse_bid_qty=500,
        nse_ask=2998.00,
        nse_ask_qty=300,
        bse_bid=3002.00,
        bse_bid_qty=150,
        bse_ask=3002.50,
        bse_ask_qty=200,
        timestamp=now,
    )

    sig = latency_engine.evaluate_arbitrage(tick)
    assert sig is not None
    assert sig.path == "BUY_NSE_SELL_BSE"
    assert sig.gross_spread_bps > 13.0
    assert sig.net_spread_bps > 8.0
    assert sig.is_actionable is True
    assert sig.executable_shares == 150  # Capped by BSE Bid Qty 150
    assert sig.ttl_ms == 250


def test_arbitrage_bse_buy_nse_sell_actionable(latency_engine):
    now = datetime(2026, 10, 18, 11, 50, 0)

    # HDFCBANK: BSE Ask is 1650.00; NSE Bid is 1652.50
    # Gross spread = (1652.50 - 1650.00) / 1650.00 * 10000 = ~15.15 bps
    tick = DualExchangeTick(
        symbol="HDFCBANK",
        nse_bid=1652.50,
        nse_bid_qty=800,
        nse_ask=1653.00,
        nse_ask_qty=500,
        bse_bid=1649.50,
        bse_bid_qty=250,
        bse_ask=1650.00,
        bse_ask_qty=400,
        timestamp=now,
    )

    sig = latency_engine.evaluate_arbitrage(tick)
    assert sig is not None
    assert sig.path == "BUY_BSE_SELL_NSE"
    assert sig.gross_spread_bps > 15.0
    assert sig.is_actionable is True
    assert sig.executable_shares == 400  # Capped by BSE Ask Qty 400


def test_sub_friction_spread_filtered(latency_engine):
    now = datetime(2026, 10, 18, 11, 55, 0)

    # Tight market: NSE Ask 3000.00, BSE Bid 3000.50 (spread 1.67 bps < 4.8 bps friction)
    tick = DualExchangeTick(
        symbol="INFY",
        nse_bid=2999.50,
        nse_bid_qty=500,
        nse_ask=3000.00,
        nse_ask_qty=500,
        bse_bid=3000.50,
        bse_bid_qty=500,
        bse_ask=3001.00,
        bse_ask_qty=500,
        timestamp=now,
    )

    sig = latency_engine.evaluate_arbitrage(tick)
    assert sig is not None
    assert sig.is_actionable is False
    assert sig.executable_shares == 0


def test_invalid_tick_handling(latency_engine):
    now = datetime(2026, 10, 18, 11, 58, 0)
    tick = DualExchangeTick("INVALID", 0.0, 0, 0.0, 0, 100.0, 10, 101.0, 10, now)
    sig = latency_engine.evaluate_arbitrage(tick)
    assert sig is None


def test_sqlite_persistence(latency_engine):
    now = datetime(2026, 10, 18, 12, 0, 0)
    tick = DualExchangeTick("SBIN", 800.0, 100, 800.2, 100, 802.0, 50, 802.5, 50, now)

    latency_engine.evaluate_arbitrage(tick)

    conn = latency_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, path, is_actionable FROM latency_arb_telemetry WHERE symbol = 'SBIN'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "SBIN"
    assert row[1] == "BUY_NSE_SELL_BSE"
    assert row[2] == 1
