"""
Unit Tests for Intraday Order Flow Footprint Imbalance & POC Migration Engine (Domain 132 / WP-AH)
"""

from datetime import datetime, timedelta
import pytest

from services.order_flow_poc_migration_engine import (
    OrderFlowPOCMigrationEngine,
    PriceLevelVolume,
    BarFootprintTelemetry,
)


@pytest.fixture
def of_engine():
    return OrderFlowPOCMigrationEngine(
        imbalance_ratio_threshold=3.0,
        stacked_levels_min=3,
        min_imbalance_volume=20.0,
        value_area_pct=0.70,
        poc_velocity_threshold=5.0,
        db_path=":memory:",
    )


def test_calculate_diagonal_imbalances(of_engine):
    # Construct 4 price levels with ascending diagonal buy imbalances
    # Level 0 (25000): Bid 10, Ask 15
    # Level 1 (25005): Bid 10, Ask 50 (50 >= 3 * 10 -> Buy Imbalance at 25005)
    # Level 2 (25010): Bid 10, Ask 60 (60 >= 3 * 10 -> Buy Imbalance at 25010)
    # Level 3 (25015): Bid 10, Ask 70 (70 >= 3 * 10 -> Buy Imbalance at 25015)
    levels = [
        PriceLevelVolume(price=25000.0, bid_vol=10.0, ask_vol=15.0),
        PriceLevelVolume(price=25005.0, bid_vol=10.0, ask_vol=50.0),
        PriceLevelVolume(price=25010.0, bid_vol=10.0, ask_vol=60.0),
        PriceLevelVolume(price=25015.0, bid_vol=10.0, ask_vol=70.0),
    ]

    stacked_buy, stacked_sell = of_engine.calculate_diagonal_imbalances(levels)
    assert len(stacked_buy) >= 3
    assert 25005.0 in stacked_buy
    assert 25010.0 in stacked_buy
    assert 25015.0 in stacked_buy
    assert len(stacked_sell) == 0


def test_compute_poc_and_value_area(of_engine):
    # Construct a distribution centered around 25050
    levels = [
        PriceLevelVolume(price=25030.0, bid_vol=10.0, ask_vol=10.0),   # 20
        PriceLevelVolume(price=25040.0, bid_vol=50.0, ask_vol=50.0),   # 100
        PriceLevelVolume(price=25050.0, bid_vol=200.0, ask_vol=300.0), # 500 (POC)
        PriceLevelVolume(price=25060.0, bid_vol=70.0, ask_vol=80.0),   # 150
        PriceLevelVolume(price=25070.0, bid_vol=15.0, ask_vol=15.0),   # 30
    ]
    # Total volume = 20 + 100 + 500 + 150 + 30 = 800
    # 70% threshold = 560
    # POC has 500. Next largest neighbor is 25060 (150). 500 + 150 = 650 >= 560!
    poc, vah, val = of_engine.compute_poc_and_value_area(levels)
    assert poc == 25050.0
    assert vah >= 25050.0
    assert val <= 25050.0


def test_detect_unfinished_extremes(of_engine):
    # Poor High: large competitive volume at the extreme high tick
    levels_poor_high = [
        PriceLevelVolume(price=25000.0, bid_vol=0.0, ask_vol=5.0),    # tapered low
        PriceLevelVolume(price=25010.0, bid_vol=50.0, ask_vol=50.0),
        PriceLevelVolume(price=25020.0, bid_vol=40.0, ask_vol=45.0),  # non-tapered high
    ]
    poor_high, poor_low = of_engine.detect_unfinished_extremes(levels_poor_high)
    assert poor_high is True
    assert poor_low is False


def test_trend_expansion_up_regime(of_engine):
    t0 = datetime(2026, 10, 18, 9, 30, 0)
    levels_bar1 = [
        PriceLevelVolume(price=25000.0, bid_vol=100.0, ask_vol=100.0),
        PriceLevelVolume(price=25005.0, bid_vol=20.0, ask_vol=20.0),
    ]
    of_engine.process_bar_footprint("bar_1", 25000.0, 25005.0, 24995.0, 25000.0, levels_bar1, timestamp=t0)

    # Bar 2 at t0 + 1 min: POC leaps to 25020 (velocity = +20 pts/min) with 3 stacked buy levels
    t1 = t0 + timedelta(minutes=1)
    levels_bar2 = [
        PriceLevelVolume(price=25005.0, bid_vol=10.0, ask_vol=15.0),
        PriceLevelVolume(price=25010.0, bid_vol=10.0, ask_vol=45.0),
        PriceLevelVolume(price=25015.0, bid_vol=10.0, ask_vol=50.0),
        PriceLevelVolume(price=25020.0, bid_vol=10.0, ask_vol=300.0),  # POC at 25020
        PriceLevelVolume(price=25025.0, bid_vol=5.0, ask_vol=0.0),    # tapered high
    ]
    res2 = of_engine.process_bar_footprint("bar_2", 25005.0, 25025.0, 25005.0, 25020.0, levels_bar2, timestamp=t1)

    assert res2.poc_velocity_pts_per_min >= 5.0
    assert res2.regime == "TREND_EXPANSION_UP"
    assert res2.auction_bias == "BULLISH"
    assert "LONG_EXPANSION" in res2.execution_trigger


def test_sqlite_persistence(of_engine):
    t0 = datetime(2026, 10, 18, 10, 0, 0)
    levels = [
        PriceLevelVolume(price=25100.0, bid_vol=20.0, ask_vol=20.0),
        PriceLevelVolume(price=25105.0, bid_vol=50.0, ask_vol=50.0),
        PriceLevelVolume(price=25110.0, bid_vol=10.0, ask_vol=0.0),
    ]
    of_engine.process_bar_footprint("bar_persist", 25100.0, 25110.0, 25100.0, 25105.0, levels, timestamp=t0)

    conn = of_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT bar_id, poc_price, auction_bias FROM order_flow_poc_telemetry WHERE bar_id = 'bar_persist'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "bar_persist"
    assert row[1] == 25105.0
