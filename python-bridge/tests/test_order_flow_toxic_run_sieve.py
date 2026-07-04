r"""Unit Tests for Cross-Asset Order Flow Toxic Run & Flash Liquidity Drain Sieve (Domain 211 / WP-DI)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.order_flow_toxic_run_sieve import (
    OrderFlowToxicRunSieve,
    TradeTick,
    ToxicFlowRegime,
    MarketMakingPosture,
)


@pytest.fixture
def sieve() -> OrderFlowToxicRunSieve:
    return OrderFlowToxicRunSieve(
        baseline_kyles_lambda=0.80,
        critical_run_length=6,
        min_replenishment_ratio=0.30,
    )


def test_empty_and_single_trade(sieve: OrderFlowToxicRunSieve):
    run_len, run_dir, p_val, run_vol = sieve.analyze_trade_runs([])
    assert run_len == 0
    assert run_dir == "NEUTRAL"
    assert p_val == 1.0

    t1 = [TradeTick(timestamp_ms=1000.0, price=100.0, size=50.0, side="BUY")]
    res = sieve.evaluate_flow_sieve(
        symbol="NIFTY",
        trades=t1,
        volume_added_last_second=100.0,
        volume_consumed_last_second=50.0,
    )
    assert res.current_run_length == 1
    assert res.run_direction == "BUY"
    assert res.flow_regime == ToxicFlowRegime.BENIGN_BALANCED_FLOW
    assert res.recommended_posture == MarketMakingPosture.QUOTE_BID_AND_ASK


def test_benign_alternating_trades(sieve: OrderFlowToxicRunSieve):
    trades = [
        TradeTick(timestamp_ms=1000.0, price=100.0, size=100.0, side="BUY"),
        TradeTick(timestamp_ms=1050.0, price=100.05, size=80.0, side="SELL"),
        TradeTick(timestamp_ms=1100.0, price=100.0, size=120.0, side="BUY"),
        TradeTick(timestamp_ms=1150.0, price=100.05, size=90.0, side="SELL"),
        TradeTick(timestamp_ms=1200.0, price=100.0, size=110.0, side="BUY"),
    ]

    res = sieve.evaluate_flow_sieve(
        symbol="BANKNIFTY",
        trades=trades,
        volume_added_last_second=600.0,
        volume_consumed_last_second=500.0,
    )

    assert res.current_run_length == 1
    assert res.flow_regime == ToxicFlowRegime.BENIGN_BALANCED_FLOW
    assert res.recommended_posture == MarketMakingPosture.QUOTE_BID_AND_ASK
    assert res.bid_quote_spread_multiplier == 1.0
    assert res.ask_quote_spread_multiplier == 1.0


def test_directional_toxic_buy_run(sieve: OrderFlowToxicRunSieve):
    # 7 consecutive aggressive buy trades sweeping higher
    trades = [
        TradeTick(timestamp_ms=1000.0 + i * 20.0, price=100.0 + i * 0.10, size=200.0, side="BUY")
        for i in range(7)
    ]

    res = sieve.evaluate_flow_sieve(
        symbol="RELIANCE",
        trades=trades,
        volume_added_last_second=1000.0,
        volume_consumed_last_second=1400.0,
    )

    assert res.current_run_length == 7
    assert res.run_direction == "BUY"
    assert res.run_p_value < 0.02
    assert res.flow_regime == ToxicFlowRegime.DIRECTIONAL_TOXIC_RUN
    assert res.recommended_posture == MarketMakingPosture.SKEW_QUOTES_AWAY
    assert res.ask_quote_spread_multiplier == 3.0
    assert "Widen ask spread by 3.0x" in res.tactical_directive


def test_directional_toxic_sell_run(sieve: OrderFlowToxicRunSieve):
    # 7 consecutive aggressive sell trades dumping lower
    trades = [
        TradeTick(timestamp_ms=1000.0 + i * 20.0, price=100.0 - i * 0.10, size=300.0, side="SELL")
        for i in range(7)
    ]

    res = sieve.evaluate_flow_sieve(
        symbol="INFY",
        trades=trades,
        volume_added_last_second=1500.0,
        volume_consumed_last_second=2100.0,
    )

    assert res.current_run_length == 7
    assert res.run_direction == "SELL"
    assert res.flow_regime == ToxicFlowRegime.DIRECTIONAL_TOXIC_RUN
    assert res.recommended_posture == MarketMakingPosture.SKEW_QUOTES_AWAY
    assert res.bid_quote_spread_multiplier == 3.0
    assert "Widen bid spread by 3.0x" in res.tactical_directive


def test_flash_liquidity_vacuum(sieve: OrderFlowToxicRunSieve):
    # Large violent price jumps indicating high Kyle's lambda impact
    trades = [
        TradeTick(timestamp_ms=1000.0, price=100.0, size=50.0, side="BUY"),
        TradeTick(timestamp_ms=1010.0, price=101.5, size=50.0, side="BUY"),
        TradeTick(timestamp_ms=1020.0, price=103.0, size=50.0, side="BUY"),
    ]

    # Huge consumed volume with near-zero replenishment
    res = sieve.evaluate_flow_sieve(
        symbol="TATAMOTORS",
        trades=trades,
        volume_added_last_second=10.0,
        volume_consumed_last_second=5000.0,
    )

    assert res.flow_regime == ToxicFlowRegime.FLASH_LIQUIDITY_VACUUM
    assert res.recommended_posture == MarketMakingPosture.PULL_ALL_RESTING_QUOTES
    assert res.replenishment_ratio < 0.10
    assert res.lambda_expansion_ratio > 2.2
    assert "Pull all resting quotes immediately!" in res.tactical_directive
