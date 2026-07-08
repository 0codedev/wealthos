"""
Unit Tests for High-Frequency Order Flow Toxicity & VPIN Microstructure Shock Sentry (Domain 163 / WP-BM)
"""

import pytest
from services.vpin_toxicity_sentry import (
    VPINToxicitySentry,
    TradeTick,
    VolumeBucket,
    VPINReport,
)


@pytest.fixture
def sentry():
    return VPINToxicitySentry(
        db_path=":memory:",
        vpin_window_buckets=20,
        toxic_vpin_hurdle=0.65,
        benign_vpin_hurdle=0.30,
    )


def test_slice_into_volume_buckets(sentry):
    # 5 trades of 200 shares each = 1000 shares total
    # Bucket size = 250 -> Exactly 4 buckets
    ticks = [
        TradeTick(f"t_{i}", price=100.0, volume=200.0, bid=99.9, ask=100.1)
        for i in range(5)
    ]
    buckets = sentry.slice_into_volume_buckets(ticks, bucket_size=250.0)

    assert len(buckets) == 4
    for b in buckets:
        assert b.total_volume == 250.0
    assert sum(b.total_volume for b in buckets) == 1000.0


def test_toxic_order_flow_tsunami(sentry):
    # Massive one-sided aggressive selling into the bid (100% Sell volume)
    # Price dropping: 100, 99.8, 99.6...
    ticks = []
    for i in range(50):
        # Selling below mid -> Lee-Ready signs -1
        ticks.append(
            TradeTick(
                f"t_{i}",
                price=100.0 - 0.1 * i,
                volume=500.0,
                bid=100.0 - 0.1 * i,
                ask=100.2 - 0.1 * i,
            )
        )

    # Total volume = 25,000. Bucket size = 1,000 -> 25 buckets
    rep = sentry.evaluate_order_flow_toxicity("CRASH_CO", 95.0, ticks, bucket_size=1000.0)

    assert rep.vpin_score >= 0.85
    assert rep.toxicity_regime == "TOXIC_ORDER_FLOW_TSUNAMI"
    assert rep.defense_directive == "EMERGENCY_PULL_MAKER_QUOTES_WIDEN_MAX"
    assert rep.quote_width_multiplier >= 3.0


def test_benign_noise_trader_regime(sentry):
    # Balanced noise flow: trade on ask (+1), trade on bid (-1) in equal measure
    ticks = []
    for i in range(60):
        if i % 2 == 0:
            # Buy on ask
            ticks.append(TradeTick(f"t_{i}", price=100.2, volume=500.0, bid=100.0, ask=100.2))
        else:
            # Sell on bid
            ticks.append(TradeTick(f"t_{i}", price=100.0, volume=500.0, bid=100.0, ask=100.2))

    rep = sentry.evaluate_order_flow_toxicity("NOISE_CO", 100.1, ticks, bucket_size=1000.0)

    # Imbalance per bucket should be 0 (500 buy, 500 sell)
    assert rep.vpin_score <= 0.10
    assert rep.toxicity_regime == "BENIGN_NOISE_TRADER_REGIME"
    assert rep.defense_directive == "POST_TIGHT_INSIDE_SPREAD_QUOTES"
    assert rep.quote_width_multiplier == 1.0


def test_empirical_percentile_cdf(sentry):
    ticks = [
        TradeTick(f"t_{i}", price=100.0 - 0.1 * i, volume=1000.0, bid=99.9, ask=100.1)
        for i in range(25)
    ]
    # Historical VPINs centered around 0.35
    hist = [0.20, 0.25, 0.30, 0.32, 0.35, 0.38, 0.40, 0.42, 0.45, 0.50]
    rep = sentry.evaluate_order_flow_toxicity(
        "HIST_SYM", 98.0, ticks, bucket_size=1000.0, historical_vpins=hist
    )

    assert rep.vpin_percentile == 1.0  # Current VPIN is higher than all historical


def test_sqlite_persistence(sentry):
    ticks = [TradeTick(f"t_{i}", price=100.0, volume=500.0, bid=99.9, ask=100.1) for i in range(5)]
    sentry.evaluate_order_flow_toxicity("PERSIST_SYM", 100.0, ticks, bucket_size=500.0)

    conn = sentry._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, vpin_score, regime FROM vpin_toxicity_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
