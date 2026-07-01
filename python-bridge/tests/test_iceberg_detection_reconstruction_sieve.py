"""
Unit Tests for Order Book Iceberg Detection & Hidden Reserve Reconstruction Sieve (Domain 183 / WP-CG)
"""

import pytest

from services.iceberg_detection_reconstruction_sieve import (
    IcebergDetectionReconstructionSieve,
    L2QuotePrint,
    TradePrint,
    IcebergRegimeDirective,
)


@pytest.fixture
def sieve():
    return IcebergDetectionReconstructionSieve(
        db_path=":memory:",
        max_replenish_latency_ms=15.0,
        min_replenishments_for_iceberg=3,
        cv_deterministic_threshold=0.20,
    )


def test_detect_replenishments_clean_sweep(sieve):
    # Pre-trade: Bid at 25000.0 has visible 500 shares
    quotes_pre = [L2QuotePrint(1000.0, 25000.0, 500.0, "BID")]
    # Trade: Market sell hits bid for 500 shares
    trades = [TradePrint(1005.0, 25000.0, 500.0, "SELL")]
    # Post-trade: Bid at 25000.0 immediately replenishes back to 500 shares!
    quotes_post = [L2QuotePrint(1008.0, 25000.0, 500.0, "BID")]

    replenishments = sieve.detect_replenishments(trades, quotes_pre, quotes_post)

    assert len(replenishments) == 1
    price, size, side = replenishments[0]
    assert price == 25000.0
    assert size == 500.0
    assert side == "BID"


def test_native_deterministic_buy_iceberg(sieve):
    # 4 identical 1,000-share replenishments (CV = 0.0)
    tranches = [1000.0, 1000.0, 1000.0, 1000.0]

    rep = sieve.analyze_order_flow("NIFTY", 25000.0, "BID", tranches, current_visible_size=1000.0)

    assert rep.replenishment_count == 4
    assert rep.mean_tranche_size == 1000.0
    assert rep.tranche_cv == 0.0
    assert rep.is_native_iceberg is True
    assert rep.cumulative_hidden_volume == 4000.0
    assert rep.estimated_total_parent_volume == 5000.0
    assert rep.directive == IcebergRegimeDirective.BULLISH_ICEBERG_SUPPORT_ACCUMULATION
    assert "Passive institutional accumulator" in rep.rationale


def test_randomized_synthetic_sell_iceberg(sieve):
    # 4 randomized tranches on ASK: 800, 1200, 950, 1050 (Mean=1000, CV ~ 0.16)
    tranches = [800.0, 1200.0, 950.0, 1050.0]

    rep = sieve.analyze_order_flow("RELIANCE", 3050.0, "ASK", tranches, current_visible_size=500.0)

    assert rep.replenishment_count == 4
    assert rep.cumulative_hidden_volume == 4000.0
    assert rep.directive == IcebergRegimeDirective.BEARISH_ICEBERG_RESISTANCE_DISTRIBUTION
    assert "Passive institutional seller" in rep.rationale


def test_normal_book_sub_threshold(sieve):
    # Only 2 replenishments (< min 3)
    tranches = [500.0, 500.0]

    rep = sieve.analyze_order_flow("INFY", 1950.0, "BID", tranches, current_visible_size=500.0)

    assert rep.directive == IcebergRegimeDirective.NORMAL_TRANSPARENT_BOOK
    assert rep.cumulative_hidden_volume == 0.0


def test_sqlite_persistence(sieve):
    tranches = [1000.0, 1000.0, 1000.0]
    sieve.analyze_order_flow("TCS", 4000.0, "BID", tranches)

    telemetry = sieve.get_latest_telemetry(limit=5)
    assert len(telemetry) == 1
    assert telemetry[0][0] == "TCS"
    assert telemetry[0][1] == "BID"
    assert telemetry[0][2] == 4000.0
    assert telemetry[0][3] == 3
