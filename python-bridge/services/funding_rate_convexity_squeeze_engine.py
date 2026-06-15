"""
Domain 267 / WP-FM: Cross-Exchange Crypto Funding Rate Convexity & Basis Term-Structure Squeeze Engine
======================================================================================================
Institutional quantitative derivatives engine computing funding rate convexity adjustments,
cross-venue funding rate disparity arbitrage, and crowded positioning liquidation squeeze hazards.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import math


class FundingRegime(str, Enum):
    BALANCED_FUNDING_EQUILIBRIUM = "BALANCED_FUNDING_EQUILIBRIUM"
    CROWDED_LONG_LIQUIDATION_HAZARD = "CROWDED_LONG_LIQUIDATION_HAZARD"
    CROWDED_SHORT_SQUEEZE_HAZARD = "CROWDED_SHORT_SQUEEZE_HAZARD"
    CROSS_EXCHANGE_FUNDING_CONVEXITY_ARB = "CROSS_EXCHANGE_FUNDING_CONVEXITY_ARB"


class FundingDirective(str, Enum):
    MONITOR_RATES = "MONITOR_RATES"
    DEFENSIVE_UNWIND_LONG_POSITIONS = "DEFENSIVE_UNWIND_LONG_POSITIONS"
    PRIME_SHORT_SQUEEZE_MOMENTUM = "PRIME_SHORT_SQUEEZE_MOMENTUM"
    EXECUTE_CROSS_VENUE_FUNDING_ARB = "EXECUTE_CROSS_VENUE_FUNDING_ARB"


@dataclass
class VenueFundingRate:
    venue: str
    rate_8h_pct: float  # e.g., 0.01 for 0.01% per 8h
    open_interest_usd: float
    volume_24h_usd: float


@dataclass
class FundingConvexityAssessment:
    symbol: str
    venue_primary: str
    primary_rate_8h_pct: float
    primary_annualized_yield_pct: float
    convexity_adjusted_annualized_pct: float
    open_interest_to_volume_ratio: float
    best_arb_spread_apr_pct: float
    best_counter_venue: Optional[str]
    regime: FundingRegime
    directive: FundingDirective
    rationales: List[str] = field(default_factory=list)


class FundingRateConvexitySqueezeEngine:
    """
    Computes continuous funding rate cash flow convexity corrections and identifies
    cross-exchange funding arbitrage and crowded perpetual liquidation squeeze risks.
    """

    def __init__(
        self,
        min_arb_hurdle_apr_pct: float = 12.0,       # 12% APR net hurdle for cross-venue arb
        crowded_oi_ratio_hurdle: float = 2.0,       # OI / 24h Vol >= 2.0 indicates crowded leverage
        extreme_long_rate_8h_pct: float = 0.06,     # 0.06% / 8h (~65.7% APR) is dangerous long crowding
        extreme_short_rate_8h_pct: float = -0.04,   # -0.04% / 8h (~-43.8% APR) is dangerous short crowding
        taker_fee_total_bps: float = 8.0,           # Round-trip maker/taker entry/exit friction
    ):
        self.min_arb_hurdle = min_arb_hurdle_apr_pct
        self.crowded_oi_ratio = crowded_oi_ratio_hurdle
        self.extreme_long_rate = extreme_long_rate_8h_pct
        self.extreme_short_rate = extreme_short_rate_8h_pct
        self.taker_fee_apr = (taker_fee_total_bps / 100.0) * 12.0  # Approx annualized roll friction

    def calculate_convexity_adjusted_apr(
        self,
        rate_8h_pct: float,
        spot_volatility: float = 0.60,
        funding_volatility: float = 0.80,
        correlation: float = 0.50,
    ) -> float:
        """
        Convexity adjustment: E[F_compounded] = F_simple + 0.5 * rho * sigma_S * sigma_F * dt
        Converted to annual percentage rate.
        """
        simple_apr = rate_8h_pct * 1095.0
        dt = 8.0 / (365.0 * 24.0)  # 1/1095 of a year
        # Convexity term in percentage points per annum
        convexity_pct = 0.5 * correlation * spot_volatility * funding_volatility * dt * 1095.0 * 100.0
        return simple_apr + convexity_pct

    def evaluate_funding(
        self,
        symbol: str,
        venues: List[VenueFundingRate],
        spot_volatility: float = 0.60,
    ) -> FundingConvexityAssessment:
        if not venues:
            raise ValueError("Must provide at least one venue funding rate observation")

        rationales = []
        primary = venues[0]
        p_rate = primary.rate_8h_pct
        p_apr = p_rate * 1095.0

        # Convexity-adjusted APR on primary
        adj_apr = self.calculate_convexity_adjusted_apr(p_rate, spot_volatility=spot_volatility)

        # OI to 24h Volume ratio
        vol = max(1.0, primary.volume_24h_usd)
        oi_ratio = primary.open_interest_usd / vol

        # Cross-venue funding arbitrage scanning
        best_spread_apr = 0.0
        best_counter_venue = None

        if len(venues) > 1:
            for counter in venues[1:]:
                # Spread in 8h rate
                rate_diff = abs(p_rate - counter.rate_8h_pct)
                annualized_diff = (rate_diff * 1095.0) - self.taker_fee_apr
                if annualized_diff > best_spread_apr:
                    best_spread_apr = annualized_diff
                    best_counter_venue = counter.venue

        # Regime & Directive Decision Logic
        if p_rate >= self.extreme_long_rate and oi_ratio >= self.crowded_oi_ratio:
            regime = FundingRegime.CROWDED_LONG_LIQUIDATION_HAZARD
            directive = FundingDirective.DEFENSIVE_UNWIND_LONG_POSITIONS
            rationales.append(
                f"Severe crowded long liquidation hazard on {symbol} ({primary.venue}): "
                f"8h Rate={p_rate:+.4f}% ({p_apr:.1f}% APR), OI/Vol={oi_ratio:.2f}x. "
                f"Long carry is hyper-crowded; cascading long liquidations imminent upon downward tick. "
                f"Defensively unwind long perps and tighten trailing stops."
            )
        elif p_rate <= self.extreme_short_rate and oi_ratio >= self.crowded_oi_ratio:
            regime = FundingRegime.CROWDED_SHORT_SQUEEZE_HAZARD
            directive = FundingDirective.PRIME_SHORT_SQUEEZE_MOMENTUM
            rationales.append(
                f"Explosive short squeeze hazard on {symbol} ({primary.venue}): "
                f"8h Rate={p_rate:+.4f}% ({p_apr:.1f}% APR), OI/Vol={oi_ratio:.2f}x. "
                f"Aggressive short leverage trapped in backwardation. Prime breakout momentum trigger."
            )
        elif best_spread_apr >= self.min_arb_hurdle and best_counter_venue is not None:
            regime = FundingRegime.CROSS_EXCHANGE_FUNDING_CONVEXITY_ARB
            directive = FundingDirective.EXECUTE_CROSS_VENUE_FUNDING_ARB
            rationales.append(
                f"Actionable cross-exchange funding arbitrage on {symbol}: "
                f"{primary.venue} vs {best_counter_venue} net edge={best_spread_apr:.1f}% APR "
                f"(exceeds hurdle of {self.min_arb_hurdle:.1f}%). Deploy market-neutral carry."
            )
        else:
            regime = FundingRegime.BALANCED_FUNDING_EQUILIBRIUM
            directive = FundingDirective.MONITOR_RATES
            rationales.append(
                f"Funding equilibrium on {symbol}: Rate={p_rate:+.4f}% (APR={p_apr:.1f}%), "
                f"OI/Vol={oi_ratio:.2f}x, Max Arb Spread={best_spread_apr:.1f}%. Normal monitoring."
            )

        return FundingConvexityAssessment(
            symbol=symbol,
            venue_primary=primary.venue,
            primary_rate_8h_pct=round(p_rate, 4),
            primary_annualized_yield_pct=round(p_apr, 2),
            convexity_adjusted_annualized_pct=round(adj_apr, 2),
            open_interest_to_volume_ratio=round(oi_ratio, 2),
            best_arb_spread_apr_pct=round(best_spread_apr, 2),
            best_counter_venue=best_counter_venue,
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
