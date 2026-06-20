"""
Real-Time Options Surface Wing Implied Forward Skew & Tail Loss Barrier
Domain 237 / Work Package WP-EI

Decomposes real-time implied volatility surfaces across term structures into
forward implied total variance, wing implied forward skew, risk-neutral tail loss
expectations, and automated crash collar hedging barriers.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class ForwardSkewState(str, Enum):
    TRANQUIL_UNIFORM = "TRANQUIL_UNIFORM"                      # Symmetric smile, stable forward term structure
    ELEVATED_DOWNSIDE_SKEW = "ELEVATED_DOWNSIDE_SKEW"          # Steepening put wing, growing macro anxiety
    CRASH_SKEW_HYPERINFLATION = "CRASH_SKEW_HYPERINFLATION"    # Severe tail risk, deep OTM put panic buying
    CALENDAR_VARIANCE_INVERSION = "CALENDAR_VARIANCE_INVERSION"# Forward variance < 0, calendar arbitrage


class TailBarrierDirective(str, Enum):
    UNHEDGED_NORMAL = "UNHEDGED_NORMAL"                        # Capital efficiency active, baseline risk
    DEPLOY_RATIO_PUT_SPREAD = "DEPLOY_RATIO_PUT_SPREAD"        # Finance tail puts with ATM short strikes
    MANDATORY_CRASH_COLLAR = "MANDATORY_CRASH_COLLAR"          # Force hard wing collar / tail delta lock
    EXECUTE_CALENDAR_ARB = "EXECUTE_CALENDAR_ARB"              # Free forward variance arbitrage capture


@dataclass
class OptionQuote:
    strike: float
    expiry_years: float
    implied_vol: float
    option_type: str = "put"  # 'call' or 'put'


@dataclass
class ForwardSurfaceSlice:
    t1: float
    t2: float
    forward_atm_vol: float
    forward_otm_put_vol: float
    forward_otm_call_vol: float
    forward_skew_slope: float            # (vol_put - vol_atm) / |ln(K_put/S)|
    forward_curvature: float             # (vol_put + vol_call - 2*vol_atm) / delta_k^2
    calendar_arbitrage_detected: bool
    state: ForwardSkewState


@dataclass
class TailRiskMetrics:
    crash_tail_prob: float               # P(S_T < S_0 * (1 - crash_barrier))
    expected_shortfall_pct: float        # Expected loss given crash barrier breached
    tail_expectation_bps: float          # Expected unhedged dollar loss in bps
    risk_neutral_skewness: float
    forward_slice: ForwardSurfaceSlice
    directive: TailBarrierDirective
    recommended_put_strike: float
    hedge_ratio: float                   # 0.0 to 1.0 (fraction of portfolio to collar)
    rationales: List[str] = field(default_factory=list)


class OptionsForwardSkewTailBarrier:
    """
    Computes forward implied variance across option expiries, detects calendar
    inversions, evaluates wing skew steepening, and issues defensive hedging barriers.
    """

    def __init__(
        self,
        crash_barrier_pct: float = 0.15,          # 15% crash barrier
        skew_elevated_threshold: float = 0.40,    # Skew slope threshold for elevated anxiety
        skew_hyperinflation_threshold: float = 0.85, # Extreme tail panic threshold
        max_acceptable_tail_loss_bps: float = 75.0,  # Max unhedged tail loss before mandatory collar
    ):
        self.crash_barrier_pct = crash_barrier_pct
        self.skew_elevated_threshold = skew_elevated_threshold
        self.skew_hyperinflation_threshold = skew_hyperinflation_threshold
        self.max_acceptable_tail_loss_bps = max_acceptable_tail_loss_bps

    def compute_forward_slice(
        self,
        spot: float,
        t1: float,
        t2: float,
        quotes_t1: Dict[str, float],  # keys: 'atm', 'otm_put', 'otm_call'
        quotes_t2: Dict[str, float],  # keys: 'atm', 'otm_put', 'otm_call'
        otm_put_strike: float,
        otm_call_strike: float,
    ) -> ForwardSurfaceSlice:
        """
        Calculates forward implied volatility and forward skew between t1 and t2:
        w_F(K) = sigma^2(K, t2)*t2 - sigma^2(K, t1)*t1
        sigma_F(K) = sqrt(max(0, w_F(K)) / (t2 - t1))
        """
        dt = t2 - t1
        if dt <= 0.001:
            raise ValueError("t2 must be strictly greater than t1.")

        def forward_vol(iv1: float, iv2: float) -> Tuple[float, bool]:
            w1 = (iv1 ** 2) * t1
            w2 = (iv2 ** 2) * t2
            dw = w2 - w1
            if dw < -1e-6:
                return (0.0, True)  # Calendar variance inversion arbitrage
            f_vol = math.sqrt(max(0.0, dw) / dt)
            return (f_vol, False)

        f_atm, arb_atm = forward_vol(quotes_t1["atm"], quotes_t2["atm"])
        f_put, arb_put = forward_vol(quotes_t1["otm_put"], quotes_t2["otm_put"])
        f_call, arb_call = forward_vol(quotes_t1["otm_call"], quotes_t2["otm_call"])

        has_arbitrage = arb_atm or arb_put or arb_call

        k_put = abs(math.log(max(1e-4, otm_put_strike / spot)))
        k_call = abs(math.log(max(1e-4, otm_call_strike / spot)))

        # Forward skew slope: (f_put - f_atm) / k_put
        skew_slope = (f_put - f_atm) / max(0.01, k_put)

        # Forward wing curvature: (f_put + f_call - 2 * f_atm) / (0.5 * (k_put + k_call))^2
        avg_k = 0.5 * (k_put + k_call)
        curvature = (f_put + f_call - 2.0 * f_atm) / max(0.001, avg_k ** 2)

        # State determination
        if has_arbitrage:
            state = ForwardSkewState.CALENDAR_VARIANCE_INVERSION
        elif skew_slope >= self.skew_hyperinflation_threshold:
            state = ForwardSkewState.CRASH_SKEW_HYPERINFLATION
        elif skew_slope >= self.skew_elevated_threshold:
            state = ForwardSkewState.ELEVATED_DOWNSIDE_SKEW
        else:
            state = ForwardSkewState.TRANQUIL_UNIFORM

        return ForwardSurfaceSlice(
            t1=t1,
            t2=t2,
            forward_atm_vol=round(f_atm, 4),
            forward_otm_put_vol=round(f_put, 4),
            forward_otm_call_vol=round(f_call, 4),
            forward_skew_slope=round(skew_slope, 4),
            forward_curvature=round(curvature, 4),
            calendar_arbitrage_detected=has_arbitrage,
            state=state,
        )

    def assess_tail_risk(
        self,
        spot: float,
        portfolio_notional: float,
        forward_slice: ForwardSurfaceSlice,
        otm_put_strike: float,
    ) -> TailRiskMetrics:
        """
        Computes forward crash probability, Expected Shortfall below barrier,
        and derives deterministic hedging directives.
        """
        rationales: List[str] = []
        dt = forward_slice.t2 - forward_slice.t1
        vol = max(0.05, forward_slice.forward_otm_put_vol)

        # Normal cumulative approximation for tail probability:
        # ln(S_T/S_0) ~ N(-0.5*vol^2*dt, vol^2*dt)
        barrier_level = spot * (1.0 - self.crash_barrier_pct)
        log_return_barrier = math.log(barrier_level / spot)
        mu = -0.5 * (vol ** 2) * dt
        std = vol * math.sqrt(dt)

        if std > 0:
            d2 = (log_return_barrier - mu) / std
            # Standard normal CDF approximation (Abramowitz-Stegun)
            def phi(z: float) -> float:
                return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
            crash_prob = phi(d2)
        else:
            crash_prob = 0.0

        # Adjust crash probability by forward skew slope inflation factor
        skew_factor = max(1.0, 1.0 + forward_slice.forward_skew_slope)
        adjusted_crash_prob = min(0.99, crash_prob * skew_factor)

        # Expected Shortfall (conditional loss beyond 15% barrier)
        base_shortfall_pct = self.crash_barrier_pct + (0.4 * vol * math.sqrt(dt))
        expected_shortfall_pct = min(0.80, base_shortfall_pct)

        # Unhedged tail loss expectation in basis points
        tail_loss_bps = adjusted_crash_prob * expected_shortfall_pct * 10000.0

        # Risk-neutral skewness approximation via Bakshi-Kapadia-Madan skew metric:
        rn_skewness = -2.5 * forward_slice.forward_skew_slope

        # Hedging Directives:
        if forward_slice.calendar_arbitrage_detected:
            directive = TailBarrierDirective.EXECUTE_CALENDAR_ARB
            hedge_ratio = 0.0
            rationales.append(f"Negative forward total variance detected (dw < 0) between {forward_slice.t1}y and {forward_slice.t2}y. Calendar spread arbitrage active.")

        elif forward_slice.state == ForwardSkewState.CRASH_SKEW_HYPERINFLATION:
            directive = TailBarrierDirective.MANDATORY_CRASH_COLLAR
            hedge_ratio = min(1.0, max(0.5, tail_loss_bps / 150.0))
            rationales.append(f"Wing forward skew hyperinflation ({forward_slice.forward_skew_slope:.3f}). Hard collar lock mandatory.")

        elif forward_slice.state == ForwardSkewState.ELEVATED_DOWNSIDE_SKEW:
            if tail_loss_bps >= self.max_acceptable_tail_loss_bps:
                directive = TailBarrierDirective.MANDATORY_CRASH_COLLAR
                hedge_ratio = min(1.0, max(0.4, tail_loss_bps / 200.0))
                rationales.append(f"Elevated downside forward skew ({forward_slice.forward_skew_slope:.3f}) with high tail loss expectation ({tail_loss_bps:.1f} bps). Escalating to mandatory crash collar.")
            else:
                directive = TailBarrierDirective.DEPLOY_RATIO_PUT_SPREAD
                hedge_ratio = 0.35
                rationales.append(f"Elevated downside forward skew ({forward_slice.forward_skew_slope:.3f}). Deploy 1x2 ratio put spread to finance wing tail insurance.")

        elif tail_loss_bps >= (self.max_acceptable_tail_loss_bps * 3.5):
            directive = TailBarrierDirective.MANDATORY_CRASH_COLLAR
            hedge_ratio = 0.50
            rationales.append(f"Catastrophic tail loss expectation ({tail_loss_bps:.1f} bps) despite symmetric smile. Precautionary collar required.")

        else:
            directive = TailBarrierDirective.UNHEDGED_NORMAL
            hedge_ratio = 0.0
            rationales.append("Forward smile symmetric and tail loss expectation within safe tolerance. Normal unhedged posture.")

        return TailRiskMetrics(
            crash_tail_prob=round(adjusted_crash_prob, 4),
            expected_shortfall_pct=round(expected_shortfall_pct, 4),
            tail_expectation_bps=round(tail_loss_bps, 2),
            risk_neutral_skewness=round(rn_skewness, 3),
            forward_slice=forward_slice,
            directive=directive,
            recommended_put_strike=round(barrier_level, 2),
            hedge_ratio=round(hedge_ratio, 2),
            rationales=rationales,
        )
