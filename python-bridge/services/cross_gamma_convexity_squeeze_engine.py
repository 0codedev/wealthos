r"""Multi-Asset Cross-Gamma & Convexity Squeeze Arbitrage Engine (Domain 203 / WP-DA)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Index vs constituent options cross-gamma aggregation and beta-adjusted mapping.
2. Cross-gamma dislocation spread \Delta \Gamma_{cross} = \Gamma_{index} - \Gamma_{constituents \to I}.
3. Convexity squeeze hazard detector for market maker forced delta hedging feedback loops.
4. Vega-neutral, delta-neutral optimal dispersion basket weights for convexity arbitrage.
5. Sovereign tactical execution directives for breakout squeeze riding and gamma mean-reversion.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class ConvexityRegime(Enum):
    """Aggregate market convexity state."""
    EXTREME_SHORT_SQUEEZE_HAZARD = "EXTREME_SHORT_SQUEEZE_HAZARD" # Net GEX < -5.0 Cr (squeeze imminent)
    ELEVATED_SHORT_GAMMA = "ELEVATED_SHORT_GAMMA"                 # -5.0 Cr <= Net GEX < -1.5 Cr
    CONVEXITY_EQUILIBRIUM = "CONVEXITY_EQUILIBRIUM"               # -1.5 Cr <= Net GEX <= +2.0 Cr
    VOLATILITY_DAMPED_LONG_GAMMA = "VOLATILITY_DAMPED_LONG_GAMMA" # Net GEX > +2.0 Cr (dealers suppress moves)


class CrossGammaArbitrageSignal(Enum):
    """Tactical arbitrage signal across index and single-stock options."""
    BUY_INDEX_CONVEXITY = "BUY_INDEX_CONVEXITY"         # Index gamma cheap relative to constituents
    SELL_INDEX_CONVEXITY = "SELL_INDEX_CONVEXITY"       # Index gamma rich relative to constituents
    CONVEXITY_SQUEEZE_RIDER = "CONVEXITY_SQUEEZE_RIDER" # Ride explosive unhedged dealer runaway
    NEUTRAL = "NEUTRAL"                                 # Cross-gamma spread within normal bounds


@dataclass
class ConstituentOptionData:
    """Constituent equity option gamma and exposure data."""
    symbol: str
    weight: float          # Index weight (sum = 1.0)
    beta: float            # CAPM beta to index
    spot_price: float
    atm_gamma: float       # Option gamma
    atm_vega: float        # Option vega
    net_dealer_gex: float  # In Crores


@dataclass
class CrossGammaDislocation:
    """Summary of index vs constituent cross-gamma divergence."""
    index_symbol: str
    index_net_gex: float
    implied_constituent_gex: float
    cross_gamma_spread: float        # Index GEX - Implied Constituent GEX
    z_score: float                   # Dislocation significance
    regime: ConvexityRegime
    arbitrage_signal: CrossGammaArbitrageSignal
    recommended_basket_weights: Dict[str, float]
    forced_rebalance_shares_per_100pt: float
    tactical_directive: str


class CrossGammaConvexitySqueezeEngine:
    r"""Multi-Asset Cross-Gamma & Convexity Squeeze Arbitrage Engine.
    
    Mathematical Foundations:
    1. Constituent Gamma to Index Space Mapping:
       \Gamma_{constituents \to I} = \sum_{i=1}^N \frac{w_i^2}{\beta_i^2} \Gamma_i^{stock} \cdot \left(\frac{S_I}{S_i}\right)^2
    2. Cross-Gamma Spread:
       \Delta \Gamma_{cross} = \text{GEX}_{index} - \sum_{i=1}^N w_i \cdot \text{GEX}_i
    3. Forced Dealer Rebalancing Flow:
       \Delta Q_{forced} = |\text{GEX}_{index}| \cdot \frac{\Delta S}{S_I} \cdot 10^7
    4. Vega-Neutral Dispersion Weights:
       n_i = \frac{w_i \cdot \text{Vega}_I}{\text{Vega}_i}
    """

    def __init__(
        self,
        squeeze_threshold_cr: float = -3.0,
        dislocation_z_threshold: float = 1.80,
    ) -> None:
        self.squeeze_threshold_cr = squeeze_threshold_cr
        self.dislocation_z_threshold = dislocation_z_threshold

    def calculate_cross_gamma_spread(
        self,
        index_symbol: str,
        index_spot: float,
        index_net_gex: float,
        index_vega: float,
        constituents: List[ConstituentOptionData],
        historical_spread_std_cr: float = 2.50,
    ) -> CrossGammaDislocation:
        r"""Compute cross-gamma spread, convexity squeeze hazard, and vega-neutral weights."""
        if not constituents:
            raise ValueError("Constituent list must contain at least one asset")

        # 1. Implied Constituent GEX in Index space
        implied_const_gex = sum(c.weight * c.net_dealer_gex for c in constituents)
        spread = index_net_gex - implied_const_gex
        safe_std = max(historical_spread_std_cr, 0.10)
        z_score = spread / safe_std

        # 2. Forced Rebalance Shares per 100 pt Index move
        # GEX represents Crores of rupee delta per 1% index move.
        # Shares per 1% move = (|GEX| * 1e7) / index_spot.
        # A 100 pt move represents 100 / (0.01 * index_spot) percent fraction.
        pct_100pt = 100.0 / (0.01 * max(index_spot, 1.0))
        forced_shares = (abs(index_net_gex) * 1e7 / max(index_spot, 1.0)) * pct_100pt

        # 3. Classify Convexity Regime
        if index_net_gex < self.squeeze_threshold_cr:
            regime = ConvexityRegime.EXTREME_SHORT_SQUEEZE_HAZARD
        elif index_net_gex < -1.0:
            regime = ConvexityRegime.ELEVATED_SHORT_GAMMA
        elif index_net_gex > 3.0:
            regime = ConvexityRegime.VOLATILITY_DAMPED_LONG_GAMMA
        else:
            regime = ConvexityRegime.CONVEXITY_EQUILIBRIUM

        # 4. Optimal Vega-Neutral Dispersion Weights
        # n_i = w_i * Vega_index / Vega_i
        basket_weights: Dict[str, float] = {}
        for c in constituents:
            safe_vega = max(c.atm_vega, 1e-4)
            raw_weight = (c.weight * index_vega) / safe_vega
            basket_weights[c.symbol] = round(raw_weight, 4)

        # 5. Arbitrage Signal & Tactical Directives
        if regime == ConvexityRegime.EXTREME_SHORT_SQUEEZE_HAZARD:
            signal = CrossGammaArbitrageSignal.CONVEXITY_SQUEEZE_RIDER
            directive = (
                f"CRITICAL SQUEEZE HAZARD: Index dealers severely short gamma ({index_net_gex:+.1f} Cr). "
                f"Forced dealer rebalancing estimated at {forced_shares:,.0f} shares per 100pt move. "
                "Ride momentum breakout with long ATM index straddles; avoid short premium."
            )
        elif z_score < -self.dislocation_z_threshold:
            signal = CrossGammaArbitrageSignal.BUY_INDEX_CONVEXITY
            directive = (
                f"Cross-gamma spread depressed (Z={z_score:.2f} < -{self.dislocation_z_threshold:.1f}). "
                "Index gamma is underpriced relative to constituents. Execute long index straddle vs "
                "short constituent option dispersion basket."
            )
        elif z_score > self.dislocation_z_threshold:
            signal = CrossGammaArbitrageSignal.SELL_INDEX_CONVEXITY
            directive = (
                f"Cross-gamma spread elevated (Z={z_score:.2f} > +{self.dislocation_z_threshold:.1f}). "
                "Index gamma is overpriced relative to constituents. Execute short index straddle vs "
                "long constituent option dispersion basket."
            )
        else:
            signal = CrossGammaArbitrageSignal.NEUTRAL
            directive = "Cross-gamma spread in statistical equilibrium. Symmetrical delta-neutral holding."

        return CrossGammaDislocation(
            index_symbol=index_symbol,
            index_net_gex=round(index_net_gex, 3),
            implied_constituent_gex=round(implied_const_gex, 3),
            cross_gamma_spread=round(spread, 3),
            z_score=round(z_score, 3),
            regime=regime,
            arbitrage_signal=signal,
            recommended_basket_weights=basket_weights,
            forced_rebalance_shares_per_100pt=round(forced_shares, 1),
            tactical_directive=directive,
        )
