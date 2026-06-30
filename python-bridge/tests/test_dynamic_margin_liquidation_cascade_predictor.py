r"""Unit Tests for Machine-Learned Dynamic Margin & Liquidation Cascade Predictor (Domain 209 / WP-DG)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.dynamic_margin_liquidation_cascade_predictor import (
    DynamicMarginLiquidationCascadePredictor,
    PositionMarginState,
    LiquidationClusterTier,
    CascadeRiskRegime,
    AccountLiquidationPosture,
    DeleveragingAction,
)


@pytest.fixture
def predictor() -> DynamicMarginLiquidationCascadePredictor:
    return DynamicMarginLiquidationCascadePredictor(
        vol_scaling_alpha=0.50,
        theta_0=-2.50,
        theta_density=1.80,
        theta_vol=0.80,
        theta_buffer=12.0,
    )


def test_effective_margin_rate_scaling(predictor: DynamicMarginLiquidationCascadePredictor):
    # Base rate 5%, realized vol == ref vol (0.20) -> no scaling
    rate_normal = predictor.calculate_effective_margin_rate(
        base_rate=0.05,
        realized_vol=0.20,
        ref_vol=0.20,
    )
    assert rate_normal == 0.05

    # Realized vol 0.40 (100% excess) -> 0.05 * (1 + 0.5 * 1.0) = 0.075
    rate_elevated = predictor.calculate_effective_margin_rate(
        base_rate=0.05,
        realized_vol=0.40,
        ref_vol=0.20,
    )
    assert pytest.approx(rate_elevated, 1e-4) == 0.075


def test_liquidation_price_long_and_short(predictor: DynamicMarginLiquidationCascadePredictor):
    # Long: 10 units at 1000, Equity = 2000, MM rate = 0.10
    # Q * P_liq * (1 - 0.10) = 10 * 1000 - 2000 = 8000
    # P_liq = 8000 / (10 * 0.90) = 888.89
    p_liq_long = predictor.calculate_liquidation_price(
        side="LONG",
        position_size=10.0,
        mark_price=1000.0,
        account_equity=2000.0,
        effective_mm_rate=0.10,
    )
    assert pytest.approx(p_liq_long, 0.01) == 888.89

    # Short: 10 units at 1000, Equity = 2000, MM rate = 0.10
    # Q * P_liq * (1 + 0.10) = 2000 + 10 * 1000 = 12000
    # P_liq = 12000 / (10 * 1.10) = 1090.91
    p_liq_short = predictor.calculate_liquidation_price(
        side="SHORT",
        position_size=10.0,
        mark_price=1000.0,
        account_equity=2000.0,
        effective_mm_rate=0.10,
    )
    assert pytest.approx(p_liq_short, 0.01) == 1090.91


def test_benign_regime_healthy_account(predictor: DynamicMarginLiquidationCascadePredictor):
    pos = PositionMarginState(
        symbol="BTC-PERP",
        side="LONG",
        position_size=2.0,
        entry_price=65000.0,
        mark_price=65500.0,
        account_equity=40000.0,       # Very high equity
        base_maintenance_margin_rate=0.05,
        realized_volatility=0.18,
        reference_volatility=0.20,
    )

    result = predictor.evaluate_margin_and_cascade(
        position=pos,
        liquidation_clusters=[],
        order_book_bid_ask_depth_near=100000.0,
    )

    assert result.account_posture == AccountLiquidationPosture.HEALTHY_SAFE
    assert result.margin_ratio > 2.0
    assert result.cascade_regime == CascadeRiskRegime.BENIGN
    assert result.recommended_action == DeleveragingAction.MAINTAIN_NORMAL
    assert result.suggested_size_reduction == 0.0


def test_elevated_watch_regime(predictor: DynamicMarginLiquidationCascadePredictor):
    pos = PositionMarginState(
        symbol="ETH-PERP",
        side="LONG",
        position_size=50.0,
        entry_price=3500.0,
        mark_price=3300.0,
        account_equity=12000.0,       # Stressed margin
        base_maintenance_margin_rate=0.05,
        realized_volatility=0.35,     # High vol
        reference_volatility=0.20,
    )

    clusters = [
        LiquidationClusterTier(trigger_price=3250.0, estimated_volume=150.0, distance_pct=0.015),
    ]

    result = predictor.evaluate_margin_and_cascade(
        position=pos,
        liquidation_clusters=clusters,
        order_book_bid_ask_depth_near=200.0,
    )

    assert result.account_posture in (AccountLiquidationPosture.MARGIN_STRESSED, AccountLiquidationPosture.IMMINENT_LIQUIDATION)
    assert result.recommended_action in (DeleveragingAction.SCALE_DOWN_LEVERAGE, DeleveragingAction.EMERGENCY_PROACTIVE_EXIT)
    assert result.suggested_size_reduction > 0.0


def test_acute_cascade_fire_sale_contagion(predictor: DynamicMarginLiquidationCascadePredictor):
    pos = PositionMarginState(
        symbol="SOL-PERP",
        side="LONG",
        position_size=100.0,
        entry_price=150.0,
        mark_price=142.0,
        account_equity=1200.0,        # Very low equity
        base_maintenance_margin_rate=0.05,
        realized_volatility=0.60,     # Extreme vol
        reference_volatility=0.20,
    )

    # Giant liquidation wall right under mark price in thin book
    clusters = [
        LiquidationClusterTier(trigger_price=141.0, estimated_volume=50000.0, distance_pct=0.007),
    ]

    result = predictor.evaluate_margin_and_cascade(
        position=pos,
        liquidation_clusters=clusters,
        order_book_bid_ask_depth_near=2000.0, # Thin order book depth
    )

    assert result.cascade_regime == CascadeRiskRegime.ACUTE_CASCADE_WARNING
    assert result.recommended_action == DeleveragingAction.EMERGENCY_PROACTIVE_EXIT
    assert result.suggested_size_reduction >= 75.0
