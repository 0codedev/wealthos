"""
Unit Test Suite for Domain 260: Cross-Exchange Crypto Collateralized Debt Position Liquidation Waterfall & MEV Sentry
"""

import pytest
from services.cdp_liquidation_waterfall_sentry import (
    CDPLiquidationWaterfallSentry,
    CDPVaultSnapshot,
    CDPHealthRegime,
    LiquidationActionDirective,
)


@pytest.fixture
def sentry():
    return CDPLiquidationWaterfallSentry(
        cascade_slippage_coeff=0.05,
        max_mev_tip_fraction=0.85,
    )


def test_nominal_collateral_health(sentry):
    # 500 WETH collateral at $3,000 = $1.5M collateral. LT = 80% -> collateral max debt = $1.2M
    # Actual debt = $600k -> HF = 1.2M / 600k = 2.00
    vault = CDPVaultSnapshot(
        vault_id="AAVE-WETH-001",
        collateral_asset="WETH",
        debt_asset="USDC",
        collateral_amount=500.0,
        debt_amount_usd=600_000.0,
        current_collateral_price=3000.0,
        liquidation_threshold=0.80,
    )
    res = sentry.evaluate_vault(vault)
    assert res.regime == CDPHealthRegime.NOMINAL_COLLATERAL_HEALTH
    assert res.directive == LiquidationActionDirective.MONITOR_PASSIVE_DEBT
    assert res.health_factor == 2.00
    assert res.distance_to_liquidation_pct > 40.0


def test_elevated_cascade_vulnerability(sentry):
    # Debt = $1.0M. Collateral = 500 WETH at $2600 = $1.3M. LT = 0.82 -> max debt = $1.066M
    # HF = 1.066M / 1.0M = 1.066
    vault = CDPVaultSnapshot(
        vault_id="MAKER-WETH-002",
        collateral_asset="WETH",
        debt_asset="DAI",
        collateral_amount=500.0,
        debt_amount_usd=1_000_000.0,
        current_collateral_price=2600.0,
        liquidation_threshold=0.82,
    )
    res = sentry.evaluate_vault(vault)
    assert res.regime == CDPHealthRegime.ELEVATED_CASCADE_VULNERABILITY
    assert res.directive == LiquidationActionDirective.PREPARE_CASCADE_DEFENSE
    assert 1.05 <= res.health_factor <= 1.30


def test_supercritical_waterfall_imminent(sentry):
    # P_current = $2460, P_liq = $2439 -> distance = 0.85% < 5%, HF = 1.008
    # Debt = $1.0M, Collateral = 500 WETH at $2460 = $1.23M * 0.82 = $1.0086M
    vault = CDPVaultSnapshot(
        vault_id="MORPHO-WETH-003",
        collateral_asset="WETH",
        debt_asset="USDC",
        collateral_amount=500.0,
        debt_amount_usd=1_000_000.0,
        current_collateral_price=2460.0,
        liquidation_threshold=0.82,
        dex_pool_liquidity_depth_usd=5_000_000.0,
    )
    res = sentry.evaluate_vault(vault)
    assert res.regime == CDPHealthRegime.SUPERCRITICAL_WATERFALL_IMMINENT
    assert res.directive == LiquidationActionDirective.EVACUATE_BIDS_ANTICIPATE_DUMP
    assert res.distance_to_liquidation_pct < 5.0
    assert res.expected_cascade_slippage_bps > 5.0


def test_active_liquidation_auction(sentry):
    # Collateral price dropped to $2300 < P_liq ($2439), HF = 0.943
    vault = CDPVaultSnapshot(
        vault_id="LIQ-TARGET-004",
        collateral_asset="WETH",
        debt_asset="USDT",
        collateral_amount=500.0,
        debt_amount_usd=1_000_000.0,
        current_collateral_price=2300.0,
        liquidation_threshold=0.82,
        liquidation_bonus_pct=5.0,
        mev_bribe_fraction=0.75,
        gas_cost_usd=50.0,
    )
    res = sentry.evaluate_vault(vault)
    assert res.regime == CDPHealthRegime.ACTIVE_LIQUIDATION_AUCTION
    assert res.directive == LiquidationActionDirective.DISPATCH_MEV_LIQUIDATION_BUNDLE
    assert res.health_factor < 1.00
    assert res.gross_liquidation_bonus_usd == 25_000.0
    assert res.net_mev_profit_usd > 5000.0
