"""
Unit Tests for Multi-Timeframe Volume Accumulation-Distribution (A/D) Chaikin Money Flow Sieve (Domain 153 / WP-BC)
"""

import pytest
from services.chaikin_money_flow_sieve import (
    ChaikinMoneyFlowSieve,
    BarData,
    CMFAnalysisReport,
)


@pytest.fixture
def sieve():
    return ChaikinMoneyFlowSieve(
        db_path=":memory:",
        cmf_period=20,
        bullish_threshold=0.12,
        bearish_threshold=-0.12,
    )


def test_mfm_bounds_and_extremes(sieve):
    # Close at high -> +1.0
    assert sieve.calculate_mfm(high=100.0, low=90.0, close=100.0) == 1.0
    # Close at low -> -1.0
    assert sieve.calculate_mfm(high=100.0, low=90.0, close=90.0) == -1.0
    # Close at midpoint -> 0.0
    assert sieve.calculate_mfm(high=100.0, low=90.0, close=95.0) == 0.0
    # Zero spread -> 0.0
    assert sieve.calculate_mfm(high=100.0, low=100.0, close=100.0) == 0.0


def test_bullish_stealth_accumulation(sieve):
    # 20 bars where price oscillates around 1000 (flat, net change <= 0.5%)
    # but each candle closes at the top 80% of its range -> strong institutional accumulation!
    bars = []
    for i in range(25):
        # Open 998, Low 995, High 1005, Close 1003 (close near high, spread=10, 2*1003 - 2000 = 6 / 10 = +0.6 MFM)
        bars.append(
            BarData(
                timestamp=f"bar_{i}",
                open=998.0,
                high=1005.0,
                low=995.0,
                close=1003.0,
                volume=15000.0,
            )
        )

    rep = sieve.evaluate_flow("INFY", bars)

    assert rep.cmf > 0.12
    assert rep.adl_slope > 0.0
    assert abs(rep.price_change_pct) < 0.50
    assert rep.regime == "BULLISH_STEALTH_ACCUMULATION"
    assert rep.trade_directive == "ACCUMULATE_LONG_STEALTH_FLOW"
    assert rep.confidence_score >= 0.85


def test_bearish_stealth_distribution(sieve):
    # 20 bars where price stays flat around 500, but closes near the low of every candle -> stealth distribution
    bars = []
    for i in range(25):
        # High 505, Low 495, Close 497 (MFM = (2*497 - 1000)/10 = -6/10 = -0.60)
        bars.append(
            BarData(
                timestamp=f"bar_{i}",
                open=502.0,
                high=505.0,
                low=495.0,
                close=497.0,
                volume=20000.0,
            )
        )

    rep = sieve.evaluate_flow("SBIN", bars)

    assert rep.cmf < -0.12
    assert rep.adl_slope < 0.0
    assert abs(rep.price_change_pct) < 0.50
    assert rep.regime == "BEARISH_STEALTH_DISTRIBUTION"
    assert rep.trade_directive == "DISTRIBUTE_OR_SHORT_FLOW"
    assert rep.confidence_score >= 0.85


def test_bullish_expansion_confirmed(sieve):
    # Price trends upwards from 100 to 125 with strong buying flow
    bars = []
    for i in range(25):
        base = 100.0 + i
        bars.append(
            BarData(
                timestamp=f"bar_{i}",
                open=base,
                high=base + 2.0,
                low=base - 0.5,
                close=base + 1.8,
                volume=10000.0,
            )
        )

    rep = sieve.evaluate_flow("TATAMOTORS", bars)

    assert rep.cmf > 0.12
    assert rep.price_change_pct > 0.50
    assert rep.regime == "BULLISH_EXPANSION_CONFIRMED"
    assert rep.trade_directive == "FOLLOW_MOMENTUM_LONG"


def test_neutral_volume_equilibrium(sieve):
    # Perfect midpoint closes (MFM = 0.0)
    bars = []
    for i in range(25):
        bars.append(
            BarData(
                timestamp=f"bar_{i}",
                open=100.0,
                high=110.0,
                low=90.0,
                close=100.0,
                volume=1000.0,
            )
        )

    rep = sieve.evaluate_flow("STABLE_CO", bars)

    assert abs(rep.cmf) < 0.01
    assert rep.regime == "NEUTRAL_VOLUME_EQUILIBRIUM"
    assert rep.trade_directive == "MAINTAIN_NEUTRAL_POSITION"


def test_sqlite_persistence(sieve):
    bars = [
        BarData(f"bar_{i}", open=100.0, high=102.0, low=98.0, close=101.0, volume=1000.0)
        for i in range(22)
    ]
    sieve.evaluate_flow("PERSIST_SYM", bars)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, cmf, regime FROM chaikin_cmf_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
