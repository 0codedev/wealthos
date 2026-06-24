"""
Domain 268 / WP-FN: Cross-Asset Volatility Risk Premium (VRP) Harvesting & Gamma Scalping Kernel
=============================================================================================
Institutional quantitative options and variance engine computing the Volatility Risk Premium (VRP),
dynamic delta-hedging bands, and gamma scalping execution triggers across multi-asset books.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import math


class VRPRegime(str, Enum):
    EQUILIBRIUM_FAIR_VOLATILITY = "EQUILIBRIUM_FAIR_VOLATILITY"
    SHORT_VRP_HARVEST_DELTA_NEUTRAL = "SHORT_VRP_HARVEST_DELTA_NEUTRAL"
    LONG_GAMMA_EXPLOSIVE_CONVEXITY = "LONG_GAMMA_EXPLOSIVE_CONVEXITY"
    GAMMA_SCALP_REBALANCE_TRIGGER = "GAMMA_SCALP_REBALANCE_TRIGGER"


class VRPDirective(str, Enum):
    MAINTAIN_CURRENT_INVENTORY = "MAINTAIN_CURRENT_INVENTORY"
    DEPLOY_SHORT_VARIANCE_CARRY = "DEPLOY_SHORT_VARIANCE_CARRY"
    DEPLOY_LONG_GAMMA_STRADDLE = "DEPLOY_LONG_GAMMA_STRADDLE"
    EXECUTE_UNDERLYING_DELTA_HEDGE = "EXECUTE_UNDERLYING_DELTA_HEDGE"


@dataclass
class PortfolioGreeks:
    underlying_price: float
    net_delta: float       # In underlying units
    net_gamma: float       # dDelta / dS
    net_vega_usd: float    # Dollar P&L per 1 vol point move
    net_theta_usd_day: float # Dollar decay per day


@dataclass
class VRPScalpAssessment:
    asset: str
    implied_vol_pct: float
    realized_vol_pct: float
    vrp_spread_pts: float
    vrp_ratio: float
    current_net_delta: float
    delta_hedge_bandwidth: float
    recommended_hedge_shares: float
    regime: VRPRegime
    directive: VRPDirective
    rationales: List[str] = field(default_factory=list)


class VRPGammaScalpingKernel:
    """
    Evaluates the Volatility Risk Premium (VRP) spread and manages dynamic gamma scalping
    delta-hedging bands to optimize carry harvest and prevent unhedged directional leakage.
    """

    def __init__(
        self,
        min_short_vrp_pts: float = 3.5,       # Implied - Realized >= 3.5 pts for short vol harvest
        min_short_vrp_ratio: float = 1.20,    # Implied / Realized >= 1.20
        inverted_vrp_threshold_pts: float = -2.0, # Implied - Realized <= -2.0 pts indicates crash inversion
        base_delta_band: float = 0.05,        # Base delta drift tolerance
        transaction_cost_bps: float = 4.0,    # Friction per hedge trade
    ):
        self.min_short_vrp_pts = min_short_vrp_pts
        self.min_short_vrp_ratio = min_short_vrp_ratio
        self.inverted_vrp_threshold_pts = inverted_vrp_threshold_pts
        self.base_delta_band = base_delta_band
        self.cost_bps = transaction_cost_bps

    def calculate_delta_bandwidth(
        self,
        gamma: float,
        spot: float,
        realized_vol: float,
    ) -> float:
        """
        Optimal asymptotic delta-hedging band under transaction costs:
        Band scales inversely with portfolio gamma.
        """
        abs_gamma = max(1e-4, abs(gamma))
        vol_factor = max(0.5, min(2.0, realized_vol / 0.20))
        band = self.base_delta_band * math.pow(0.02 / abs_gamma, 0.35) * math.sqrt(vol_factor)
        return max(0.01, min(0.20, band))

    def evaluate_vrp_and_hedging(
        self,
        asset: str,
        implied_vol_pct: float,
        realized_vol_pct: float,
        greeks: PortfolioGreeks,
    ) -> VRPScalpAssessment:
        rationales = []
        iv = max(1.0, implied_vol_pct)
        rv = max(1.0, realized_vol_pct)

        vrp_spread = iv - rv
        vrp_ratio = iv / rv

        # Compute dynamic delta hedge bandwidth
        delta_band = self.calculate_delta_bandwidth(
            gamma=greeks.net_gamma,
            spot=greeks.underlying_price,
            realized_vol=rv / 100.0,
        )

        current_delta = greeks.net_delta
        hedge_shares = 0.0

        # Check if delta rebalance is immediately triggered
        delta_drift = abs(current_delta)
        is_delta_breached = delta_drift >= delta_band

        if is_delta_breached:
            hedge_shares = -current_delta  # Rebalance back to 0.0 delta
            regime = VRPRegime.GAMMA_SCALP_REBALANCE_TRIGGER
            directive = VRPDirective.EXECUTE_UNDERLYING_DELTA_HEDGE
            side = "BUY" if hedge_shares > 0 else "SELL"
            rationales.append(
                f"Delta-hedging band breach on {asset}: Net delta={current_delta:+.3f} "
                f"exceeds optimal band (+/-{delta_band:.3f}). "
                f"Execute immediate gamma scalp hedge: {side} {abs(hedge_shares):.2f} underlying shares."
            )
        elif vrp_spread <= self.inverted_vrp_threshold_pts:
            regime = VRPRegime.LONG_GAMMA_EXPLOSIVE_CONVEXITY
            directive = VRPDirective.DEPLOY_LONG_GAMMA_STRADDLE
            rationales.append(
                f"Inverted volatility regime on {asset}: Realized ({rv:.1f}%) exceeds Implied ({iv:.1f}%) "
                f"by {abs(vrp_spread):.1f} pts. Short vol is lethal in realized jump regime. "
                f"Deploy long gamma straddles and scalp realized intraday swings."
            )
        elif vrp_spread >= self.min_short_vrp_pts and vrp_ratio >= self.min_short_vrp_ratio:
            regime = VRPRegime.SHORT_VRP_HARVEST_DELTA_NEUTRAL
            directive = VRPDirective.DEPLOY_SHORT_VARIANCE_CARRY
            rationales.append(
                f"Abundant Volatility Risk Premium on {asset}: Implied={iv:.1f}% vs Realized={rv:.1f}% "
                f"(Spread={vrp_spread:+.1f} pts, Ratio={vrp_ratio:.2f}x). "
                f"Deploy delta-neutral short volatility carry to harvest variance premium; Theta={greeks.net_theta_usd_day:+.1f} USD/day."
            )
        else:
            regime = VRPRegime.EQUILIBRIUM_FAIR_VOLATILITY
            directive = VRPDirective.MAINTAIN_CURRENT_INVENTORY
            rationales.append(
                f"Fair volatility pricing on {asset}: Spread={vrp_spread:+.1f} pts within equilibrium. "
                f"Delta within band (+/-{delta_band:.3f}). Maintain current inventory."
            )

        return VRPScalpAssessment(
            asset=asset,
            implied_vol_pct=round(iv, 2),
            realized_vol_pct=round(rv, 2),
            vrp_spread_pts=round(vrp_spread, 2),
            vrp_ratio=round(vrp_ratio, 3),
            current_net_delta=round(current_delta, 4),
            delta_hedge_bandwidth=round(delta_band, 4),
            recommended_hedge_shares=round(hedge_shares, 4),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
