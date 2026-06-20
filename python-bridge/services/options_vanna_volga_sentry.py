"""
Domain 275 / WP-FU: Real-Time Options Surface Dual-Wing Vanna-Volga Pricing & Tail Risk Sentry
=============================================================================================
Institutional quantitative options engine computing exact Castagna-Mercurio Vanna-Volga
replication weights (Vega, Vanna, Volga) and pricing wings across FX and crypto derivatives.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import math


class VannaVolgaRegime(str, Enum):
    VANNA_VOLGA_EQUILIBRIUM = "VANNA_VOLGA_EQUILIBRIUM"
    OVERPRICED_WING_VOLGA_ARBITRAGE = "OVERPRICED_WING_VOLGA_ARBITRAGE"
    UNDERPRICED_WING_CRASH_BARRIER = "UNDERPRICED_WING_CRASH_BARRIER"


class VannaVolgaDirective(str, Enum):
    MAINTAIN_CURRENT_QUOTES = "MAINTAIN_CURRENT_QUOTES"
    DEPLOY_SHORT_WING_VANNA_HEDGE = "DEPLOY_SHORT_WING_VANNA_HEDGE"
    ACQUIRE_UNDERPRICED_TAIL_CONVEXITY = "ACQUIRE_UNDERPRICED_TAIL_CONVEXITY"


@dataclass
class LiquidBenchmarkQuotes:
    spot: float
    atm_strike: float
    atm_vol_pct: float
    put_25d_strike: float
    put_25d_vol_pct: float
    call_25d_strike: float
    call_25d_vol_pct: float


@dataclass
class VannaVolgaAssessment:
    symbol: str
    target_strike: float
    market_iv_pct: float
    theoretical_vv_iv_pct: float
    iv_dislocation_pts: float
    weight_25d_put: float
    weight_atm: float
    weight_25d_call: float
    regime: VannaVolgaRegime
    directive: VannaVolgaDirective
    rationales: List[str] = field(default_factory=list)


class OptionsVannaVolgaSentry:
    """
    Implements the Castagna-Mercurio Vanna-Volga methodology to construct Vega-Vanna-Volga
    consistent smile interpolation and identify structural tail wing mispricings.
    """

    def __init__(
        self,
        overpricing_hurdle_pts: float = 3.0,   # 3.0 vol pts over theoretical is overpriced
        underpricing_hurdle_pts: float = -2.5, # 2.5 vol pts under theoretical is cheap insurance
    ):
        self.over_hurdle = overpricing_hurdle_pts
        self.under_hurdle = underpricing_hurdle_pts

    def calculate_vv_weights(
        self,
        k: float,
        k_p: float,
        k_atm: float,
        k_c: float,
    ) -> tuple[float, float, float]:
        """
        Calculates analytical Vanna-Volga replication weights w_P, w_ATM, w_C.
        """
        ln_k = math.log(k)
        ln_kp = math.log(k_p)
        ln_katm = math.log(k_atm)
        ln_kc = math.log(k_c)

        # Denominators
        den_p = (ln_kp - ln_katm) * (ln_kp - ln_kc)
        den_c = (ln_kc - ln_kp) * (ln_kc - ln_katm)
        den_atm = (ln_katm - ln_kp) * (ln_katm - ln_kc)

        # Numerators
        num_p = (ln_k - ln_katm) * (ln_k - ln_kc)
        num_c = (ln_k - ln_kp) * (ln_k - ln_katm)
        num_atm = (ln_k - ln_kp) * (ln_k - ln_kc)

        def safe_div(num: float, den: float) -> float:
            if abs(den) < 1e-7:
                den = 1e-7 if den >= 0 else -1e-7
            return num / den

        w_p = safe_div(num_p, den_p)
        w_c = safe_div(num_c, den_c)
        w_atm = safe_div(num_atm, den_atm)

        return w_p, w_atm, w_c

    def calculate_theoretical_vol(
        self,
        k: float,
        bm: LiquidBenchmarkQuotes,
    ) -> float:
        """
        Castagna-Mercurio 2nd-order analytical implied volatility smile formula.
        """
        w_p, w_atm, w_c = self.calculate_vv_weights(
            k, bm.put_25d_strike, bm.atm_strike, bm.call_25d_strike
        )

        sigma_atm = bm.atm_vol_pct
        sigma_p = bm.put_25d_vol_pct
        sigma_c = bm.call_25d_vol_pct

        # Linear combination in implied volatility space
        sigma_vv = w_atm * sigma_atm + w_p * sigma_p + w_c * sigma_c
        return max(1.0, sigma_vv)

    def evaluate_wing(
        self,
        symbol: str,
        target_strike: float,
        market_quoted_iv_pct: float,
        benchmarks: LiquidBenchmarkQuotes,
    ) -> VannaVolgaAssessment:
        rationales = []
        w_p, w_atm, w_c = self.calculate_vv_weights(
            target_strike,
            benchmarks.put_25d_strike,
            benchmarks.atm_strike,
            benchmarks.call_25d_strike,
        )

        theo_iv = self.calculate_theoretical_vol(target_strike, benchmarks)
        dislocation = market_quoted_iv_pct - theo_iv

        # Decision State Machine
        if dislocation >= self.over_hurdle:
            regime = VannaVolgaRegime.OVERPRICED_WING_VOLGA_ARBITRAGE
            directive = VannaVolgaDirective.DEPLOY_SHORT_WING_VANNA_HEDGE
            rationales.append(
                f"Severely overpriced wing on {symbol} (K={target_strike:.1f}): Market IV={market_quoted_iv_pct:.1f}% "
                f"vs Vanna-Volga Fair IV={theo_iv:.1f}% (Edge={dislocation:+.1f} vol pts >= {self.over_hurdle:.1f} pts). "
                f"Short wing options and hedge Vega/Vanna/Volga using 25D vanillas (w_P={w_p:.2f}, w_C={w_c:.2f})."
            )
        elif dislocation <= self.under_hurdle:
            regime = VannaVolgaRegime.UNDERPRICED_WING_CRASH_BARRIER
            directive = VannaVolgaDirective.ACQUIRE_UNDERPRICED_TAIL_CONVEXITY
            rationales.append(
                f"Cheap tail insurance wing on {symbol} (K={target_strike:.1f}): Market IV={market_quoted_iv_pct:.1f}% "
                f"trades {abs(dislocation):.1f} vol pts below Vanna-Volga Fair IV ({theo_iv:.1f}%). "
                f"Acquire underpriced tail puts for convexity and catastrophic crash protection."
            )
        else:
            regime = VannaVolgaRegime.VANNA_VOLGA_EQUILIBRIUM
            directive = VannaVolgaDirective.MAINTAIN_CURRENT_QUOTES
            rationales.append(
                f"Vanna-Volga smile equilibrium on {symbol} (K={target_strike:.1f}): Market IV={market_quoted_iv_pct:.1f}% "
                f"tracks theoretical IV={theo_iv:.1f}% within hurdle ({dislocation:+.1f} pts). Normal quoting."
            )

        return VannaVolgaAssessment(
            symbol=symbol,
            target_strike=round(target_strike, 2),
            market_iv_pct=round(market_quoted_iv_pct, 2),
            theoretical_vv_iv_pct=round(theo_iv, 2),
            iv_dislocation_pts=round(dislocation, 2),
            weight_25d_put=round(w_p, 4),
            weight_atm=round(w_atm, 4),
            weight_25d_call=round(w_c, 4),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
