r"""Unit Tests for High-Frequency Limit Order Book Co-Integration & Dynamic Pairs Hedging Engine (Domain 215 / WP-DM)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.lob_cointegration_pairs_hedging_engine import (
    LOBCointegrationPairsHedgingEngine,
    AssetQuote,
    PairsRegimeStatus,
    PairsExecutionAction,
)


@pytest.fixture
def engine() -> LOBCointegrationPairsHedgingEngine:
    return LOBCointegrationPairsHedgingEngine(
        entry_z_threshold=2.0,
        exit_z_threshold=0.5,
        breakdown_z_threshold=4.5,
        max_acceptable_half_life_sec=120.0,
        taker_fee_bps_per_leg=0.50,
    )


def test_ou_calibration_mean_reverting_series(engine: LOBCointegrationPairsHedgingEngine):
    # Generate stationary AR(1) process with b=0.90 (theta = -ln(0.9) ~ 0.105, half life ~ 6.5s)
    history = [0.0]
    for i in range(100):
        # S_t = 0.9 * S_{t-1} + small noise
        noise = 0.001 * math.sin(i * 0.5)
        nxt = 0.90 * history[-1] + noise
        history.append(nxt)

    ou = engine.calibrate_ou_process(history)
    assert ou.theta_mean_reversion_speed > 0.05
    assert ou.half_life_seconds < 20.0
    assert ou.sigma_equilibrium > 0.0


def test_spread_equilibrium_standby(engine: LOBCointegrationPairsHedgingEngine):
    # Series centered around 0.0
    history = [0.001 * math.sin(i * 0.2) for i in range(50)]

    q1 = AssetQuote(symbol="HDFCBANK", bid_price=1500.0, ask_price=1500.20)
    q2 = AssetQuote(symbol="ICICIBANK", bid_price=1000.0, ask_price=1000.15)
    # With beta=1.0, current spread = ln(1500.1) - ln(1000.075) ~ 0.4055
    # Let's adjust history around this mean:
    base_spread = math.log(1500.1) - math.log(1000.075)
    hist = [base_spread + 0.0005 * math.cos(i * 0.3) for i in range(50)]

    res = engine.evaluate_pairs_signal(
        quote_1=q1,
        quote_2=q2,
        hedge_ratio_beta=1.0,
        spread_history=hist,
        base_allocation_capital=100000.0,
    )

    assert res.regime == PairsRegimeStatus.SPREAD_EQUILIBRIUM
    assert res.action in (PairsExecutionAction.STANDBY_PASSIVE, PairsExecutionAction.CLOSE_PAIR_TAKE_PROFIT)
    assert abs(res.spread_z_score) < 1.0


def test_long_spread_entry(engine: LOBCointegrationPairsHedgingEngine):
    mean_val = 0.50
    # 50 historical points with sigma approx 0.003
    hist = [mean_val + 0.004 * math.sin(i * 0.4) for i in range(50)]

    # Current quote: Asset 1 dropped -> spread dips to 0.492 (Z ~ -2.7)
    p2 = 1000.0
    p1 = p2 * math.exp(0.492)

    q1 = AssetQuote(symbol="TATAMOTORS", bid_price=p1 - 0.10, ask_price=p1 + 0.10)
    q2 = AssetQuote(symbol="MARUTI", bid_price=p2 - 0.10, ask_price=p2 + 0.10)

    res = engine.evaluate_pairs_signal(
        quote_1=q1,
        quote_2=q2,
        hedge_ratio_beta=1.0,
        spread_history=hist,
        base_allocation_capital=100000.0,
    )

    assert -4.5 < res.spread_z_score <= -2.0
    assert res.regime == PairsRegimeStatus.LONG_SPREAD_OPPORTUNITY
    assert res.action == PairsExecutionAction.ENTER_LONG_SPREAD
    assert "LONG SPREAD ENTRY" in res.tactical_directive
    assert res.leg_1_shares > 0
    assert res.leg_2_shares > 0


def test_short_spread_entry(engine: LOBCointegrationPairsHedgingEngine):
    mean_val = 0.50
    hist = [mean_val + 0.004 * math.sin(i * 0.4) for i in range(50)]

    # Current quote: Asset 1 jumped -> spread spikes to 0.508 (Z ~ +2.7)
    p2 = 1000.0
    p1 = p2 * math.exp(0.508)

    q1 = AssetQuote(symbol="INFY", bid_price=p1 - 0.10, ask_price=p1 + 0.10)
    q2 = AssetQuote(symbol="TCS", bid_price=p2 - 0.10, ask_price=p2 + 0.10)

    res = engine.evaluate_pairs_signal(
        quote_1=q1,
        quote_2=q2,
        hedge_ratio_beta=1.0,
        spread_history=hist,
        base_allocation_capital=100000.0,
    )

    assert 2.0 <= res.spread_z_score < 4.5
    assert res.regime == PairsRegimeStatus.SHORT_SPREAD_OPPORTUNITY
    assert res.action == PairsExecutionAction.ENTER_SHORT_SPREAD
    assert "SHORT SPREAD ENTRY" in res.tactical_directive


def test_cointegration_breakdown_stop(engine: LOBCointegrationPairsHedgingEngine):
    mean_val = 0.50
    hist = [mean_val + 0.002 * math.sin(i * 0.4) for i in range(50)]

    # Massive 6-sigma breakout (Z = 5.5)
    p2 = 1000.0
    p1 = p2 * math.exp(0.55) # Deep dislocation

    q1 = AssetQuote(symbol="STOCK_A", bid_price=p1 - 0.10, ask_price=p1 + 0.10)
    q2 = AssetQuote(symbol="STOCK_B", bid_price=p2 - 0.10, ask_price=p2 + 0.10)

    res = engine.evaluate_pairs_signal(
        quote_1=q1,
        quote_2=q2,
        hedge_ratio_beta=1.0,
        spread_history=hist,
    )

    assert res.regime == PairsRegimeStatus.COINTEGRATION_BREAKDOWN
    assert res.action == PairsExecutionAction.EMERGENCY_UNWIND_STOP
    assert "Emergency sever pair" in res.tactical_directive
