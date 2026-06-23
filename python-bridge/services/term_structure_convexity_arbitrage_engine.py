"""
Real-Time Options Surface Term-Structure Convexity Arbitrage Engine
Domain 239 / Work Package WP-EK

Identifies term-structure total variance convexity dislocations, enforces calendar
monotonicity constraints, and constructs vega- and duration-neutral calendar
butterfly arbitrage positions across discrete option expiries.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class TermStructureState(str, Enum):
    BALANCED_CONCAVE_SURFACE = "BALANCED_CONCAVE_SURFACE"          # Normal smooth concave total variance curve
    POSITIVE_CONVEXITY_RICH_SPIKE = "POSITIVE_CONVEXITY_RICH_SPIKE"# Middle tenor artificially overvalued vs flanks
    NEGATIVE_CONVEXITY_CHEAP_TROUGH = "NEGATIVE_CONVEXITY_CHEAP_TROUGH"# Middle tenor artificially undervalued vs flanks
    MONOTONICITY_CALENDAR_BREACH = "MONOTONICITY_CALENDAR_BREACH"  # Total variance decreases in maturity (dw/dT < 0)


class ConvexityExecutionDirective(str, Enum):
    HOLD_NEUTRAL = "HOLD_NEUTRAL"                                  # No trade; curvature within noise envelope
    EXECUTE_SHORT_CALENDAR_BUTTERFLY = "EXECUTE_SHORT_CALENDAR_BUTTERFLY" # Sell T2, Buy T1 & T3 to harvest rich premium
    EXECUTE_LONG_CALENDAR_BUTTERFLY = "EXECUTE_LONG_CALENDAR_BUTTERFLY"   # Buy T2, Sell T1 & T3 to capture cheap recovery
    EXECUTE_CALENDAR_MONOTONICITY_ARB = "EXECUTE_CALENDAR_MONOTONICITY_ARB" # Pure arbitrage: sell T1, buy T2


@dataclass
class TenorQuote:
    tenor_years: float
    implied_vol: float
    spot: float = 100.0
    strike: float = 100.0


@dataclass
class TripletConvexityDislocation:
    t1: float
    t2: float
    t3: float
    total_variance_1: float              # w1 = sigma1^2 * t1
    total_variance_2: float              # w2 = sigma2^2 * t2
    total_variance_3: float              # w3 = sigma3^2 * t3
    interpolated_w2: float               # linear benchmark between w1 and w3
    convexity_dislocation: float         # w2 - interpolated_w2
    vol_spread_bps: float                # (sigma2 - sqrt(interpolated_w2/t2)) * 10000
    vega_weights: Tuple[float, float, float]  # (w_t1, w_t2, w_t3) where w_t2 = -1.0


@dataclass
class TermStructureAssessment:
    triplets: List[TripletConvexityDislocation]
    state: TermStructureState
    directive: ConvexityExecutionDirective
    max_dislocation: float
    max_vol_spread_bps: float
    target_triplet: Optional[TripletConvexityDislocation]
    rationales: List[str] = field(default_factory=list)


class TermStructureConvexityArbitrageEngine:
    """
    Evaluates total variance term structures across expiration triplets, detecting
    calendar arbitrage and trading rich/cheap curvature via vega-neutral butterflies.
    """

    def __init__(
        self,
        rich_spread_threshold_bps: float = 40.0,    # Middle tenor >= 40 bps rich in IV
        cheap_spread_threshold_bps: float = -40.0,  # Middle tenor <= -40 bps cheap in IV
        min_tenor_gap_years: float = 0.04,          # ~2 weeks minimum spacing
    ):
        self.rich_spread_threshold_bps = rich_spread_threshold_bps
        self.cheap_spread_threshold_bps = cheap_spread_threshold_bps
        self.min_tenor_gap_years = min_tenor_gap_years

    def compute_vega(self, spot: float, strike: float, iv: float, t: float) -> float:
        """Computes Black-Scholes Vega: S * sqrt(t) * phi(d1)."""
        if t <= 0.001 or iv <= 0.001:
            return 0.001
        d1 = (math.log(spot / strike) + 0.5 * (iv ** 2) * t) / (iv * math.sqrt(t))
        phi = (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * (d1 ** 2))
        return max(1e-4, spot * math.sqrt(t) * phi)

    def analyze_triplet(self, q1: TenorQuote, q2: TenorQuote, q3: TenorQuote) -> TripletConvexityDislocation:
        """
        Analyzes a single expiration triplet (T1 < T2 < T3) for total variance convexity.
        """
        t1, t2, t3 = q1.tenor_years, q2.tenor_years, q3.tenor_years
        if not (t1 < t2 < t3):
            raise ValueError("Tenors must be strictly ordered T1 < T2 < T3.")

        w1 = (q1.implied_vol ** 2) * t1
        w2 = (q2.implied_vol ** 2) * t2
        w3 = (q3.implied_vol ** 2) * t3

        # Linear interpolation weight
        lam = (t3 - t2) / (t3 - t1)
        interpolated_w2 = lam * w1 + (1.0 - lam) * w3

        dislocation = w2 - interpolated_w2

        # Volatility spread: sigma2 - benchmark_vol
        benchmark_vol = math.sqrt(max(0.0, interpolated_w2 / t2))
        vol_spread = q2.implied_vol - benchmark_vol
        vol_spread_bps = vol_spread * 10000.0

        # Construct vega-neutral weights: Long w_1 of T1, Short 1.0 of T2, Long w_3 of T3
        vega1 = self.compute_vega(q1.spot, q1.strike, q1.implied_vol, t1)
        vega2 = self.compute_vega(q2.spot, q2.strike, q2.implied_vol, t2)
        vega3 = self.compute_vega(q3.spot, q3.strike, q3.implied_vol, t3)

        # Time duration balance: w1 * dt1 = w3 * dt3
        dt1 = t2 - t1
        dt3 = t3 - t2
        total_dt = t3 - t1

        # Standard calendar butterfly proportion:
        # Base duration weights: weight1 = dt3 / total_dt, weight3 = dt1 / total_dt
        ratio1 = dt3 / total_dt
        ratio3 = dt1 / total_dt

        # Scale to match vega of 1 unit of T2:
        # vega_basket = ratio1 * vega1 + ratio3 * vega3
        vega_basket = ratio1 * vega1 + ratio3 * vega3
        scale = vega2 / max(1e-4, vega_basket)

        w_t1 = ratio1 * scale
        w_t2 = -1.0
        w_t3 = ratio3 * scale

        return TripletConvexityDislocation(
            t1=round(t1, 4),
            t2=round(t2, 4),
            t3=round(t3, 4),
            total_variance_1=round(w1, 6),
            total_variance_2=round(w2, 6),
            total_variance_3=round(w3, 6),
            interpolated_w2=round(interpolated_w2, 6),
            convexity_dislocation=round(dislocation, 6),
            vol_spread_bps=round(vol_spread_bps, 2),
            vega_weights=(round(w_t1, 4), w_t2, round(w_t3, 4)),
        )

    def scan_term_structure(self, quotes: List[TenorQuote]) -> TermStructureAssessment:
        """
        Scans all consecutive adjacent triplets in a sorted term structure,
        identifying monotonicity calendar violations and convexity dislocations.
        """
        rationales: List[str] = []
        if len(quotes) < 3:
            return TermStructureAssessment(
                triplets=[],
                state=TermStructureState.BALANCED_CONCAVE_SURFACE,
                directive=ConvexityExecutionDirective.HOLD_NEUTRAL,
                max_dislocation=0.0,
                max_vol_spread_bps=0.0,
                target_triplet=None,
                rationales=["Insufficient tenors (minimum 3 required)."],
            )

        sorted_quotes = sorted(quotes, key=lambda q: q.tenor_years)

        # 1. First check calendar monotonicity across all adjacent pairs
        for i in range(len(sorted_quotes) - 1):
            qa = sorted_quotes[i]
            qb = sorted_quotes[i + 1]
            wa = (qa.implied_vol ** 2) * qa.tenor_years
            wb = (qb.implied_vol ** 2) * qb.tenor_years
            if wb < wa - 1e-6:
                rationales.append(
                    f"Calendar monotonicity violation: total variance drops from {wa:.5f} ({qa.tenor_years:.3f}y) to {wb:.5f} ({qb.tenor_years:.3f}y). Free calendar arbitrage."
                )
                return TermStructureAssessment(
                    triplets=[],
                    state=TermStructureState.MONOTONICITY_CALENDAR_BREACH,
                    directive=ConvexityExecutionDirective.EXECUTE_CALENDAR_MONOTONICITY_ARB,
                    max_dislocation=round(wa - wb, 6),
                    max_vol_spread_bps=round((qa.implied_vol - qb.implied_vol) * 10000.0, 2),
                    target_triplet=None,
                    rationales=rationales,
                )

        # 2. Analyze all triplets
        triplets: List[TripletConvexityDislocation] = []
        for i in range(len(sorted_quotes) - 2):
            q1 = sorted_quotes[i]
            q2 = sorted_quotes[i + 1]
            q3 = sorted_quotes[i + 2]
            if (q2.tenor_years - q1.tenor_years >= self.min_tenor_gap_years) and (q3.tenor_years - q2.tenor_years >= self.min_tenor_gap_years):
                trip = self.analyze_triplet(q1, q2, q3)
                triplets.append(trip)

        if not triplets:
            return TermStructureAssessment(
                triplets=[],
                state=TermStructureState.BALANCED_CONCAVE_SURFACE,
                directive=ConvexityExecutionDirective.HOLD_NEUTRAL,
                max_dislocation=0.0,
                max_vol_spread_bps=0.0,
                target_triplet=None,
                rationales=["No valid triplets satisfying minimum tenor gap."],
            )

        # Find extreme dislocation
        max_trip = max(triplets, key=lambda t: abs(t.vol_spread_bps))
        max_bps = max_trip.vol_spread_bps
        max_disloc = max_trip.convexity_dislocation

        if max_bps >= self.rich_spread_threshold_bps:
            state = TermStructureState.POSITIVE_CONVEXITY_RICH_SPIKE
            directive = ConvexityExecutionDirective.EXECUTE_SHORT_CALENDAR_BUTTERFLY
            rationales.append(
                f"Tenor {max_trip.t2}y is rich by +{max_bps:.1f} bps vs flanks ({max_trip.t1}y and {max_trip.t3}y). Execute vega-neutral Short Calendar Butterfly (Sell T2, Buy T1 & T3)."
            )
        elif max_bps <= self.cheap_spread_threshold_bps:
            state = TermStructureState.NEGATIVE_CONVEXITY_CHEAP_TROUGH
            directive = ConvexityExecutionDirective.EXECUTE_LONG_CALENDAR_BUTTERFLY
            rationales.append(
                f"Tenor {max_trip.t2}y is cheap by {max_bps:.1f} bps vs flanks ({max_trip.t1}y and {max_trip.t3}y). Execute vega-neutral Long Calendar Butterfly (Buy T2, Sell T1 & T3)."
            )
        else:
            state = TermStructureState.BALANCED_CONCAVE_SURFACE
            directive = ConvexityExecutionDirective.HOLD_NEUTRAL
            rationales.append(
                f"Term structure smooth. Maximum curvature dislocation {max_bps:.1f} bps is within acceptable noise envelope."
            )

        return TermStructureAssessment(
            triplets=triplets,
            state=state,
            directive=directive,
            max_dislocation=max_disloc,
            max_vol_spread_bps=max_bps,
            target_triplet=max_trip,
            rationales=rationales,
        )
