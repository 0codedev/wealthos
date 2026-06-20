r"""Real-Time Options Surface Smile Asymmetry & Vanna-Volga PDE Engine (Domain 210 / WP-DH)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Castagna-Mercurio (2007) Vanna-Volga options pricing and implied volatility smile interpolation.
2. Analytic second-order Greeks: Vega (\partial C / \partial \sigma), Vanna (\partial^2 C / \partial S \partial \sigma),
   and Volga (\partial^2 C / \partial \sigma^2).
3. Exact 3-pillar hedging weights (ATM, 25-Delta Call, 25-Delta Put) matching market smile dynamics.
4. Volatility smile asymmetry and curvature classification with arbitrage exploitation sentry.
"""

from dataclasses import dataclass
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class SmileAsymmetryRegime(Enum):
    """Regime classification for implied volatility smile profile."""
    NORMAL_EQUILIBRIUM = "NORMAL_EQUILIBRIUM"         # Standard equity/index down-sloping skew
    PANIC_DOWNSIDE_SKEW = "PANIC_DOWNSIDE_SKEW"       # Extreme put skew (crash fear)
    UPSIDE_CALL_SQUEEZE = "UPSIDE_CALL_SQUEEZE"       # Inverted skew (frenzied call buying)
    EXCESS_WING_CONVEXITY = "EXCESS_WING_CONVEXITY"   # Overpriced strangle/wings


class VolgaHedgingAction(Enum):
    """Recommended options volatility posture."""
    HOLD_DELTA_VEGA_NEUTRAL = "HOLD_DELTA_VEGA_NEUTRAL"
    SELL_OVERPRICED_WINGS = "SELL_OVERPRICED_WINGS"     # Short strangle / long ATM
    EXPLOIT_SKEW_REVERSAL = "EXPLOIT_SKEW_REVERSAL"     # Risk reversal arbitrage
    HEDGE_VANNA_IMBALANCE = "HEDGE_VANNA_IMBALANCE"     # Dynamic underlying re-hedging


@dataclass
class OptionGreeks:
    """Standard and second-order cross Greeks."""
    price: float
    delta: float
    vega: float
    vanna: float
    volga: float


@dataclass
class VannaVolgaWeights:
    """Castagna-Mercurio hedging portfolio weights."""
    w_atm: float
    w_call25: float
    w_put25: float


@dataclass
class VannaVolgaPricingResult:
    """Vanna-Volga calibrated option price and smile diagnostics."""
    spot: float
    strike: float
    time_to_expiry_years: float
    bs_price_atm_vol: float
    vanna_volga_price: float
    implied_vol_vv: float
    greeks: OptionGreeks
    weights: VannaVolgaWeights
    skew_asymmetry_index: float
    smile_curvature_index: float
    smile_regime: SmileAsymmetryRegime
    recommended_action: VolgaHedgingAction
    tactical_directive: str


class OptionsVannaVolgaPDEEngine:
    r"""Castagna-Mercurio (2007) Vanna-Volga Pricing & Smile Asymmetry Engine.
    
    Mathematical Formulation:
    1. Black-Scholes Greeks:
       d_1 = \frac{\ln(S/K) + (r + 0.5 \sigma^2)\tau}{\sigma \sqrt{\tau}}
       d_2 = d_1 - \sigma \sqrt{\tau}
       \nu = S \sqrt{\tau} \phi(d_1)
       \text{Vanna} = \frac{\nu}{S} \left(1 - \frac{d_1}{\sigma \sqrt{\tau}}\right) = -\frac{\phi(d_1) d_2}{\sigma}
       \text{Volga} = \nu \frac{d_1 d_2}{\sigma}
       
    2. Analytical Weights:
       w_2(K) = \frac{\ln(K / K_1) \ln(K / K_3)}{\ln(K_2 / K_1) \ln(K_2 / K_3)} \cdot \frac{\nu(K)}{\nu(K_2)}
       w_3(K) = \frac{\ln(K / K_1) \ln(K / K_2)}{\ln(K_3 / K_1) \ln(K_3 / K_2)} \cdot \frac{\nu(K)}{\nu(K_3)}
       w_1(K) = \frac{\nu(K) - w_2 \nu(K_2) - w_3 \nu(K_3)}{\nu(K_1)}
       
    3. Vanna-Volga Option Price:
       C_{VV}(K) = C_{BS}(K, \sigma_{atm}) + w_2 [C_{BS}(K_2, \sigma_2) - C_{BS}(K_2, \sigma_{atm})]
                                           + w_3 [C_{BS}(K_3, \sigma_3) - C_{BS}(K_3, \sigma_{atm})]
    """

    def __init__(self, risk_free_rate: float = 0.065) -> None:
        self.risk_free_rate = risk_free_rate

    @staticmethod
    def _norm_cdf(x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    @staticmethod
    def _norm_pdf(x: float) -> float:
        return (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * x * x)

    def calculate_bs_greeks(
        self,
        spot: float,
        strike: float,
        tau: float,
        vol: float,
        is_call: bool = True,
    ) -> OptionGreeks:
        """Compute Black-Scholes price, Delta, Vega, Vanna, and Volga."""
        if tau <= 1e-6 or vol <= 1e-6 or spot <= 0 or strike <= 0:
            intr = max(0.0, spot - strike) if is_call else max(0.0, strike - spot)
            return OptionGreeks(price=intr, delta=1.0 if is_call else -1.0, vega=0.0, vanna=0.0, volga=0.0)

        r = self.risk_free_rate
        sqrt_tau = math.sqrt(tau)
        d1 = (math.log(spot / strike) + (r + 0.5 * vol * vol) * tau) / (vol * sqrt_tau)
        d2 = d1 - vol * sqrt_tau

        pdf_d1 = self._norm_pdf(d1)
        cdf_d1 = self._norm_cdf(d1)
        cdf_d2 = self._norm_cdf(d2)

        discount = math.exp(-r * tau)
        if is_call:
            price = spot * cdf_d1 - strike * discount * cdf_d2
            delta = cdf_d1
        else:
            price = strike * discount * self._norm_cdf(-d2) - spot * self._norm_cdf(-d1)
            delta = cdf_d1 - 1.0

        # Vega in currency units per 100% vol (dC / d_sigma)
        vega = spot * sqrt_tau * pdf_d1

        # Vanna = d(Vega) / dS = -exp(-r*tau) * pdf(d1) * d2 / vol ... in standard Black-Scholes:
        # dVega / dS = sqrt(tau) * pdf(d1) * (1 - d1 / (vol * sqrt_tau)) = (vega / spot) * (1.0 - d1 / (vol * sqrt_tau))
        vanna = (vega / spot) * (1.0 - d1 / (vol * sqrt_tau))

        # Volga = d(Vega) / d_sigma = vega * d1 * d2 / vol
        volga = vega * (d1 * d2) / max(vol, 1e-5)

        return OptionGreeks(
            price=max(0.0, price),
            delta=delta,
            vega=max(0.0, vega),
            vanna=vanna,
            volga=volga,
        )

    def calculate_vanna_volga_weights(
        self,
        spot: float,
        strike: float,
        k_atm: float,
        k_call25: float,
        k_put25: float,
        tau: float,
        sigma_atm: float,
    ) -> VannaVolgaWeights:
        """Compute Castagna-Mercurio analytical hedging weights w_1, w_2, w_3."""
        ln_k = math.log(strike)
        ln_1 = math.log(k_atm)
        ln_2 = math.log(k_call25)
        ln_3 = math.log(k_put25)

        vega_k = self.calculate_bs_greeks(spot, strike, tau, sigma_atm).vega
        vega_1 = self.calculate_bs_greeks(spot, k_atm, tau, sigma_atm).vega
        vega_2 = self.calculate_bs_greeks(spot, k_call25, tau, sigma_atm).vega
        vega_3 = self.calculate_bs_greeks(spot, k_put25, tau, sigma_atm).vega

        # w_2 (25-delta call weight)
        denom_2 = (ln_2 - ln_1) * (ln_2 - ln_3)
        if abs(denom_2) > 1e-8 and vega_2 > 1e-6:
            w_2 = ((ln_k - ln_1) * (ln_k - ln_3) / denom_2) * (vega_k / vega_2)
        else:
            w_2 = 0.0

        # w_3 (25-delta put weight)
        denom_3 = (ln_3 - ln_1) * (ln_3 - ln_2)
        if abs(denom_3) > 1e-8 and vega_3 > 1e-6:
            w_3 = ((ln_k - ln_1) * (ln_k - ln_2) / denom_3) * (vega_k / vega_3)
        else:
            w_3 = 0.0

        # w_1 (ATM option weight)
        if vega_1 > 1e-6:
            w_1 = (vega_k - w_2 * vega_2 - w_3 * vega_3) / vega_1
        else:
            w_1 = 1.0

        return VannaVolgaWeights(w_atm=w_1, w_call25=w_2, w_put25=w_3)

    def invert_implied_vol(
        self,
        target_price: float,
        spot: float,
        strike: float,
        tau: float,
        is_call: bool = True,
        initial_vol: float = 0.20,
    ) -> float:
        """Invert Black-Scholes price to find implied volatility using Newton-Raphson."""
        vol = initial_vol
        for _ in range(30):
            greeks = self.calculate_bs_greeks(spot, strike, tau, vol, is_call)
            diff = greeks.price - target_price
            if abs(diff) < 1e-4:
                return vol
            if greeks.vega < 1e-5:
                break
            vol -= diff / greeks.vega
            if vol < 0.01:
                vol = 0.01
            elif vol > 3.0:
                vol = 3.0
        return vol

    def price_vanna_volga_option(
        self,
        spot: float,
        strike: float,
        tau: float,
        k_atm: float,
        k_call25: float,
        k_put25: float,
        sigma_atm: float,
        sigma_call25: float,
        sigma_put25: float,
        is_call: bool = True,
    ) -> VannaVolgaPricingResult:
        """Compute Vanna-Volga calibrated option price, implied volatility, and smile diagnostics."""
        # 1. Base ATM Black-Scholes price
        greeks_k = self.calculate_bs_greeks(spot, strike, tau, sigma_atm, is_call)
        c_bs_k = greeks_k.price

        # 2. Benchmark option pricing differences
        c_bs_2_sig2 = self.calculate_bs_greeks(spot, k_call25, tau, sigma_call25, is_call=True).price
        c_bs_2_sigatm = self.calculate_bs_greeks(spot, k_call25, tau, sigma_atm, is_call=True).price
        diff_2 = c_bs_2_sig2 - c_bs_2_sigatm

        c_bs_3_sig3 = self.calculate_bs_greeks(spot, k_put25, tau, sigma_put25, is_call=False).price
        c_bs_3_sigatm = self.calculate_bs_greeks(spot, k_put25, tau, sigma_atm, is_call=False).price
        diff_3 = c_bs_3_sig3 - c_bs_3_sigatm

        # 3. Weights
        weights = self.calculate_vanna_volga_weights(
            spot=spot,
            strike=strike,
            k_atm=k_atm,
            k_call25=k_call25,
            k_put25=k_put25,
            tau=tau,
            sigma_atm=sigma_atm,
        )

        # 4. Calibrated price
        c_vv = c_bs_k + weights.w_call25 * diff_2 + weights.w_put25 * diff_3
        c_vv = max(0.0, c_vv)

        # 5. Inverted Implied Volatility
        iv_vv = self.invert_implied_vol(
            target_price=c_vv,
            spot=spot,
            strike=strike,
            tau=tau,
            is_call=is_call,
            initial_vol=sigma_atm,
        )

        # 6. Smile Asymmetry & Curvature
        # Risk Reversal = sigma_call25 - sigma_put25
        risk_reversal = sigma_call25 - sigma_put25
        # Butterfly = 0.5*(sigma_call25 + sigma_put25) - sigma_atm
        butterfly = 0.5 * (sigma_call25 + sigma_put25) - sigma_atm

        skew_index = (sigma_put25 - sigma_call25) / max(sigma_atm, 0.01)
        curvature_index = butterfly / max(sigma_atm, 0.01)

        # 7. Regime & Directive
        if skew_index > 0.40:
            regime = SmileAsymmetryRegime.PANIC_DOWNSIDE_SKEW
            action = VolgaHedgingAction.EXPLOIT_SKEW_REVERSAL
            directive = (
                f"Severe downside skew asymmetry ({skew_index:+.2f}). "
                f"Put wing heavily overpriced relative to call wing. Sell expensive put risk-reversal."
            )
        elif skew_index < -0.15:
            regime = SmileAsymmetryRegime.UPSIDE_CALL_SQUEEZE
            action = VolgaHedgingAction.EXPLOIT_SKEW_REVERSAL
            directive = (
                f"Inverted call skew squeeze ({skew_index:+.2f}). "
                f"Calls trading at massive premium. Sell upside calls and buy protective downside puts."
            )
        elif curvature_index > 0.15:
            regime = SmileAsymmetryRegime.EXCESS_WING_CONVEXITY
            action = VolgaHedgingAction.SELL_OVERPRICED_WINGS
            directive = (
                f"Excessive smile curvature ({curvature_index:.2f}). "
                f"Strangle wings overpriced relative to ATM. Sell 25-delta strangle, buy ATM straddle."
            )
        else:
            regime = SmileAsymmetryRegime.NORMAL_EQUILIBRIUM
            action = VolgaHedgingAction.HOLD_DELTA_VEGA_NEUTRAL
            directive = (
                f"Balanced smile equilibrium (Skew={skew_index:+.2f}, Curv={curvature_index:.2f}). "
                f"Vanna-Volga calibrated IV: {iv_vv:.1%}. Maintain delta-vega neutral profile."
            )

        return VannaVolgaPricingResult(
            spot=spot,
            strike=strike,
            time_to_expiry_years=round(tau, 4),
            bs_price_atm_vol=round(c_bs_k, 2),
            vanna_volga_price=round(c_vv, 2),
            implied_vol_vv=round(iv_vv, 4),
            greeks=OptionGreeks(
                price=round(c_vv, 2),
                delta=round(greeks_k.delta, 4),
                vega=round(greeks_k.vega, 2),
                vanna=round(greeks_k.vanna, 4),
                volga=round(greeks_k.volga, 4),
            ),
            weights=VannaVolgaWeights(
                w_atm=round(weights.w_atm, 4),
                w_call25=round(weights.w_call25, 4),
                w_put25=round(weights.w_put25, 4),
            ),
            skew_asymmetry_index=round(skew_index, 4),
            smile_curvature_index=round(curvature_index, 4),
            smile_regime=regime,
            recommended_action=action,
            tactical_directive=directive,
        )
