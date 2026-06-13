"""
Cross-Exchange Crypto Collateralized Debt Position Liquidation Waterfall & MEV Sentry
Domain 260 / Work Package WP-FF

Monitors on-chain and cross-exchange CDP health factors, models catastrophic liquidation price thresholds,
simulates secondary market DEX liquidation waterfall slippage impact, and dispatches MEV bundle arbitrage.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class CDPHealthRegime(str, Enum):
    NOMINAL_COLLATERAL_HEALTH = "NOMINAL_COLLATERAL_HEALTH"              # HF >= 1.30, distance > 20%
    ELEVATED_CASCADE_VULNERABILITY = "ELEVATED_CASCADE_VULNERABILITY"    # 1.05 <= HF < 1.30, distance 5% - 20%
    SUPERCRITICAL_WATERFALL_IMMINENT = "SUPERCRITICAL_WATERFALL_IMMINENT"# 1.00 < HF < 1.05, distance < 5%, liquidation imminent
    ACTIVE_LIQUIDATION_AUCTION = "ACTIVE_LIQUIDATION_AUCTION"            # HF <= 1.00, underwater, active liquidation / MEV auction


class LiquidationActionDirective(str, Enum):
    MONITOR_PASSIVE_DEBT = "MONITOR_PASSIVE_DEBT"                        # Safe collateralization, standard market operations
    PREPARE_CASCADE_DEFENSE = "PREPARE_CASCADE_DEFENSE"                  # Arm liquidator bot, monitor price feeds
    EVACUATE_BIDS_ANTICIPATE_DUMP = "EVACUATE_BIDS_ANTICIPATE_DUMP"      # Pull maker bids around P_liq to avoid absorption
    DISPATCH_MEV_LIQUIDATION_BUNDLE = "DISPATCH_MEV_LIQUIDATION_BUNDLE"  # Broadcast atomic Flashbots liquidation bundle


@dataclass
class CDPVaultSnapshot:
    vault_id: str
    collateral_asset: str              # e.g. "WETH"
    debt_asset: str                    # e.g. "USDC"
    collateral_amount: float           # e.g. 500.0
    debt_amount_usd: float             # e.g. 1,000,000.0
    current_collateral_price: float    # e.g. 2600.0
    liquidation_threshold: float = 0.82# 82% threshold
    liquidation_bonus_pct: float = 5.0 # 5% bonus paid to liquidator
    dex_pool_liquidity_depth_usd: float = 10_000_000.0
    gas_cost_usd: float = 45.0
    mev_bribe_fraction: float = 0.75   # Fraction of bonus pledged to block builder


@dataclass
class CDPLiquidationAssessment:
    vault_id: str
    health_factor: float
    liquidation_price: float
    distance_to_liquidation_pct: float
    expected_cascade_slippage_bps: float
    gross_liquidation_bonus_usd: float
    net_mev_profit_usd: float
    regime: CDPHealthRegime
    directive: LiquidationActionDirective
    rationales: List[str] = field(default_factory=list)


class CDPLiquidationWaterfallSentry:
    """
    Sub-millisecond CDP health factor monitor and liquidation cascade impact calculator.
    """

    def __init__(
        self,
        cascade_slippage_coeff: float = 0.05,
        max_mev_tip_fraction: float = 0.85,
    ):
        self.cascade_slippage_coeff = cascade_slippage_coeff
        self.max_mev_tip_fraction = max_mev_tip_fraction

    def calculate_health_factor(
        self, collateral_qty: float, price: float, debt_usd: float, lt: float
    ) -> float:
        """
        HF = (Collateral * Price * LT) / Debt
        """
        if debt_usd <= 0.0:
            return 999.0
        return (collateral_qty * price * lt) / debt_usd

    def calculate_liquidation_price(
        self, debt_usd: float, collateral_qty: float, lt: float
    ) -> float:
        """
        P_liq = Debt / (Collateral * LT)
        """
        if collateral_qty <= 0.0 or lt <= 0.0:
            return 0.0
        return debt_usd / (collateral_qty * lt)

    def evaluate_vault(self, vault: CDPVaultSnapshot) -> CDPLiquidationAssessment:
        rationales: List[str] = []

        hf = self.calculate_health_factor(
            vault.collateral_amount,
            vault.current_collateral_price,
            vault.debt_amount_usd,
            vault.liquidation_threshold,
        )

        p_liq = self.calculate_liquidation_price(
            vault.debt_amount_usd,
            vault.collateral_amount,
            vault.liquidation_threshold,
        )

        # Distance to liquidation: (P_current - P_liq) / P_current * 100%
        if vault.current_collateral_price > 0.0:
            dist_pct = ((vault.current_collateral_price - p_liq) / vault.current_collateral_price) * 100.0
        else:
            dist_pct = 0.0

        # Liquidation cascade secondary market slippage
        # Liquidated collateral value: Collateral * P_liq
        collat_val_usd = vault.collateral_amount * vault.current_collateral_price
        depth_usd = max(1.0, vault.dex_pool_liquidity_depth_usd)
        impact_ratio = collat_val_usd / depth_usd
        cascade_slip_bps = impact_ratio * self.cascade_slippage_coeff * 10000.0

        # MEV liquidation economics
        # Max close factor typically 50%
        repayable_debt = vault.debt_amount_usd * 0.50
        gross_bonus_usd = repayable_debt * (vault.liquidation_bonus_pct / 100.0)
        builder_bribe = gross_bonus_usd * min(self.max_mev_tip_fraction, vault.mev_bribe_fraction)
        net_mev_usd = max(0.0, gross_bonus_usd - builder_bribe - vault.gas_cost_usd)

        # Decision State Machine
        if hf <= 1.00:
            regime = CDPHealthRegime.ACTIVE_LIQUIDATION_AUCTION
            directive = LiquidationActionDirective.DISPATCH_MEV_LIQUIDATION_BUNDLE
            rationales.append(
                f"Active liquidation auction on vault {vault.vault_id}: Health Factor={hf:.4f} <= 1.00. "
                f"Underwater by {abs(dist_pct):.2f}%. Gross bonus=${gross_bonus_usd:,.2f}, Net MEV=${net_mev_usd:,.2f}. "
                f"Dispatching atomic Flashbots liquidation bundle."
            )

        elif hf <= 1.05 or dist_pct <= 5.0:
            regime = CDPHealthRegime.SUPERCRITICAL_WATERFALL_IMMINENT
            directive = LiquidationActionDirective.EVACUATE_BIDS_ANTICIPATE_DUMP
            rationales.append(
                f"Supercritical liquidation waterfall imminent on {vault.vault_id}: Health Factor={hf:.4f} < 1.05. "
                f"Collateral price ${vault.current_collateral_price:.2f} within {dist_pct:.1f}% of P_liq (${p_liq:.2f}). "
                f"Expected cascade dump will cause {cascade_slip_bps:.1f} bps DEX slippage. Evacuate resting bids."
            )

        elif hf <= 1.30 or dist_pct <= 20.0:
            regime = CDPHealthRegime.ELEVATED_CASCADE_VULNERABILITY
            directive = LiquidationActionDirective.PREPARE_CASCADE_DEFENSE
            rationales.append(
                f"Elevated cascade vulnerability on {vault.vault_id}: Health Factor={hf:.4f}, "
                f"Distance to liquidation={dist_pct:.1f}%. Monitoring oracle updates and DEX liquidity."
            )

        else:
            regime = CDPHealthRegime.NOMINAL_COLLATERAL_HEALTH
            directive = LiquidationActionDirective.MONITOR_PASSIVE_DEBT
            rationales.append(
                f"Nominal collateral health on {vault.vault_id}: Health Factor={hf:.2f} >= 1.30. "
                f"Safe buffer of {dist_pct:.1f}% to liquidation price ${p_liq:.2f}."
            )

        return CDPLiquidationAssessment(
            vault_id=vault.vault_id,
            health_factor=round(hf, 4),
            liquidation_price=round(p_liq, 2),
            distance_to_liquidation_pct=round(dist_pct, 2),
            expected_cascade_slippage_bps=round(cascade_slip_bps, 2),
            gross_liquidation_bonus_usd=round(gross_bonus_usd, 2),
            net_mev_profit_usd=round(net_mev_usd, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
