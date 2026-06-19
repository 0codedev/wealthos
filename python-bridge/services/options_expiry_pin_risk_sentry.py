r"""Real-Time Options Expiry Pin Risk & Multi-Asset Delta Hedging Sentry (Domain 201 / WP-CY)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Avellaneda-Lipkin (2003) & Jeantheau (2004) dealer gamma gravity and strike pinning mechanics.
2. Dynamic strike pinning probability \mathcal{P}_{pin}(S, K, \tau, \Gamma_{net}) with mean-reverting drift.
3. Multi-strike Net Dealer Gamma (GEX) surface and Max Pain gravitational center.
4. Expiry afternoon (14:30 - 15:30 IST) discontinuous delta collapse and underlying rebalancing surge sentry.
5. Tactical execution directives: Pin harvest straddle capture vs gamma squeeze breakout rider.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class DealerGammaRegime(Enum):
    """Aggregate dealer gamma positioning state."""
    STRONG_LONG_GAMMA = "STRONG_LONG_GAMMA"   # Dealers damp volatility (high pinning gravity)
    MILD_LONG_GAMMA = "MILD_LONG_GAMMA"       # Moderate mean-reversion toward strike
    NEUTRAL_GAMMA = "NEUTRAL_GAMMA"           # Symmetrical flow, low pinning force
    MILD_SHORT_GAMMA = "MILD_SHORT_GAMMA"     # Moderate volatility amplification
    STRONG_SHORT_GAMMA = "STRONG_SHORT_GAMMA" # Explosive gamma squeeze / runaway cascade risk


class PinningTargetStatus(Enum):
    """Classification of strike pinning likelihood."""
    LOCKED_PIN = "LOCKED_PIN"           # P(pin) >= 70% (high probability pin)
    CONVERGENT_GRAVITY = "CONVERGENT_GRAVITY" # 45% <= P(pin) < 70% (attractive force)
    UNPINNED_DRIFT = "UNPINNED_DRIFT"   # P(pin) < 45% (free diffusion)
    GAMMA_ESCAPE = "GAMMA_ESCAPE"       # Spot broke outside pinning basin of attraction


@dataclass
class StrikeGEXProfile:
    """Option strike-level gamma exposure and pinning gravity."""
    strike: float
    call_oi: float
    put_oi: float
    total_oi: float
    call_gamma: float
    put_gamma: float
    net_dealer_gex: float      # Positive = long gamma (stabilizing), Negative = short gamma (accelerating)
    gravitational_pull: float  # Attractor force pulling spot toward strike
    pin_probability: float     # 0.0 to 1.0 probability of closing within +/- half strike interval


@dataclass
class ExpiryPinRiskReport:
    """Consolidated options expiry day pin risk and delta rebalancing assessment."""
    spot_price: float
    time_to_expiry_days: float # Remaining time in fractions of day (e.g. 0.05 = ~1.8 hours)
    current_iv: float
    dealer_gamma_regime: DealerGammaRegime
    total_market_gex: float
    primary_pin_strike: float
    primary_pin_probability: float
    strike_profiles: List[StrikeGEXProfile]
    underlying_delta_rebalance_surge_shares: float
    tactical_directive: str
    action_type: str


class OptionsExpiryPinRiskSentry:
    r"""Real-Time Options Expiry Pin Risk & Multi-Asset Delta Hedging Sentry.
    
    Formulation:
    1. Black-Scholes Gamma:
       \Gamma = \frac{\phi(d_1)}{S \sigma \sqrt{\tau}}
    2. Net Dealer Gamma (GEX):
       \text{GEX}(K) = S \cdot \left[ \text{OI}_{call} \cdot \Gamma_{call} - \text{OI}_{put} \cdot \Gamma_{put} \right] \cdot \text{LotSize}
    3. Dealer Gravitational Force (Avellaneda-Lipkin):
       F_{pin}(S, K) = -\kappa \cdot \text{GEX}(K) \cdot (S - K) \cdot \exp\left(-\frac{(S - K)^2}{2 (\sigma S \sqrt{\tau})^2}\right)
    4. Pinning Probability:
       \mathcal{P}_{pin} = \Phi\left(\frac{K + \frac{1}{2}\Delta K - S_{\tau}}{\sigma S \sqrt{\tau}}\right) - \Phi\left(\frac{K - \frac{1}{2}\Delta K - S_{\tau}}{\sigma S \sqrt{\tau}}\right)
    """

    def __init__(
        self,
        lot_size: int = 25,  # Standard NIFTY index lot size
        strike_step: float = 50.0,
        kappa_gravity: float = 0.05,
    ) -> None:
        self.lot_size = lot_size
        self.strike_step = strike_step
        self.kappa_gravity = kappa_gravity

    def _std_norm_cdf(self, x: float) -> float:
        """Standard Normal Cumulative Distribution Function approximation."""
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    def _std_norm_pdf(self, x: float) -> float:
        """Standard Normal Probability Density Function."""
        return (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * x * x)

    def calculate_black_scholes_gamma(
        self,
        spot: float,
        strike: float,
        tau_years: float,
        iv: float,
        r: float = 0.065,
    ) -> float:
        r"""Compute option gamma: \Gamma = \frac{\phi(d_1)}{S \sigma \sqrt{\tau}}."""
        safe_tau = max(tau_years, 1e-5)
        safe_iv = max(iv, 1e-4)
        vol_sqrt_t = safe_iv * math.sqrt(safe_tau)

        d1 = (math.log(spot / strike) + (r + 0.5 * safe_iv * safe_iv) * safe_tau) / vol_sqrt_t
        pdf_d1 = self._std_norm_pdf(d1)
        gamma = pdf_d1 / (spot * vol_sqrt_t)
        return gamma

    def calculate_pin_probability(
        self,
        spot: float,
        strike: float,
        tau_days: float,
        iv: float,
        gex_stabilization: float = 0.0,
    ) -> float:
        r"""Compute probability of underlying expiring within +/- half strike step interval of K:
        
        P(K - 0.5\Delta K \le S_T \le K + 0.5\Delta K)
        """
        tau_years = max(tau_days / 365.0, 1e-6)
        sigma = max(iv, 1e-3)
        std_dev = spot * sigma * math.sqrt(tau_years)
        safe_std = max(std_dev, 1e-3)

        # Mean-reverting drift induced by dealer long gamma
        # If GEX > 0, drift pulls spot toward strike
        drift_pull = 0.0
        if gex_stabilization > 0:
            drift_factor = min(0.60, gex_stabilization * 0.1)
            drift_pull = drift_factor * (strike - spot)

        expected_spot = spot + drift_pull

        upper_bound = strike + 0.5 * self.strike_step
        lower_bound = strike - 0.5 * self.strike_step

        z_upper = (upper_bound - expected_spot) / safe_std
        z_lower = (lower_bound - expected_spot) / safe_std

        prob = self._std_norm_cdf(z_upper) - self._std_norm_cdf(z_lower)
        return max(0.0, min(1.0, prob))

    def evaluate_expiry_pin_risk(
        self,
        spot_price: float,
        tau_days: float,
        iv: float,
        options_chain: List[Dict[str, Any]],
    ) -> ExpiryPinRiskReport:
        r"""Analyze full options chain to determine gamma gravity landscape, pin likelihood, and delta surges."""
        tau_years = max(tau_days / 365.0, 1e-6)

        profiles: List[StrikeGEXProfile] = []
        total_market_gex = 0.0

        for row in options_chain:
            k = float(row["strike"])
            call_oi = float(row.get("call_oi", 0.0))
            put_oi = float(row.get("put_oi", 0.0))
            total_oi = call_oi + put_oi

            gamma_val = self.calculate_black_scholes_gamma(
                spot=spot_price,
                strike=k,
                tau_years=tau_years,
                iv=iv,
            )

            # Net Dealer GEX convention:
            # Customers are typically long calls (dealers short calls -> long gamma on dip, short gamma on rally)
            # and long puts (dealers short puts -> long gamma).
            # Market Maker net positioning: Dealers long index gamma from retail puts, short from upside calls.
            # Standard GEX: S * (Call_OI * Gamma - Put_OI * Gamma) * LotSize
            call_gex = spot_price * (call_oi * self.lot_size) * gamma_val
            put_gex = spot_price * (put_oi * self.lot_size) * gamma_val
            net_gex = (call_gex - put_gex) / 1e7  # Normalized in Crores

            total_market_gex += net_gex

            # Gravitational pull toward strike
            dist = spot_price - k
            decay_scale = max(spot_price * iv * math.sqrt(tau_years), 5.0)
            basin_weight = math.exp(-0.5 * ((dist / decay_scale) ** 2))
            pull = -self.kappa_gravity * net_gex * dist * basin_weight

            # Pinning probability
            p_pin = self.calculate_pin_probability(
                spot=spot_price,
                strike=k,
                tau_days=tau_days,
                iv=iv,
                gex_stabilization=max(0.0, net_gex),
            )

            profiles.append(
                StrikeGEXProfile(
                    strike=k,
                    call_oi=call_oi,
                    put_oi=put_oi,
                    total_oi=total_oi,
                    call_gamma=round(gamma_val, 6),
                    put_gamma=round(gamma_val, 6),
                    net_dealer_gex=round(net_gex, 3),
                    gravitational_pull=round(pull, 4),
                    pin_probability=round(p_pin, 4),
                )
            )

        # Sort strikes by pinning probability descending
        profiles.sort(key=lambda p: p.pin_probability, reverse=True)
        primary_strike_prof = profiles[0] if profiles else None

        primary_k = primary_strike_prof.strike if primary_strike_prof else spot_price
        primary_p_pin = primary_strike_prof.pin_probability if primary_strike_prof else 0.0

        # Classify Dealer Gamma Regime
        if total_market_gex > 5.0:
            regime = DealerGammaRegime.STRONG_LONG_GAMMA
        elif total_market_gex > 1.0:
            regime = DealerGammaRegime.MILD_LONG_GAMMA
        elif total_market_gex < -5.0:
            regime = DealerGammaRegime.STRONG_SHORT_GAMMA
        elif total_market_gex < -1.0:
            regime = DealerGammaRegime.MILD_SHORT_GAMMA
        else:
            regime = DealerGammaRegime.NEUTRAL_GAMMA

        # Underlying Delta Rebalancing Surge Estimation
        # If spot moves 10 points in tau_days, compute required delta rebalance shares
        delta_s = self.strike_step * 0.20
        total_gamma_shares = sum(
            (p.call_gamma * p.call_oi + p.put_gamma * p.put_oi) * self.lot_size
            for p in profiles
        )
        rebalance_shares = total_gamma_shares * delta_s

        # Tactical Directive Determination
        if primary_p_pin >= 0.70 and regime in (DealerGammaRegime.STRONG_LONG_GAMMA, DealerGammaRegime.MILD_LONG_GAMMA):
            action = "PIN_HARVEST_STRADDLE"
            directive = (
                f"High-confidence expiry pin at Strike {primary_k:.0f} (P_pin={primary_p_pin:.1%}). "
                f"Dealers net long gamma (GEX={total_market_gex:+.1f} Cr). Harvest theta decay on "
                f"{primary_k:.0f} short straddle/iron butterfly with stop collar at +/- {self.strike_step:.0f} pts."
            )
        elif regime in (DealerGammaRegime.STRONG_SHORT_GAMMA, DealerGammaRegime.MILD_SHORT_GAMMA):
            action = "GAMMA_SQUEEZE_BREAKOUT"
            directive = (
                f"Negative dealer gamma regime (GEX={total_market_gex:+.1f} Cr). Pinning broken! "
                f"Dealers must chase momentum; ride breakout beyond {primary_k:.0f} with tight trailing stop."
            )
        else:
            action = "PASSIVE_DELTA_DEFENSE"
            directive = (
                f"Balanced/neutral gamma regime (GEX={total_market_gex:+.1f} Cr). Primary pin candidate {primary_k:.0f} "
                f"(P_pin={primary_p_pin:.1%}). Monitor 14:30 IST delta surges."
            )

        return ExpiryPinRiskReport(
            spot_price=spot_price,
            time_to_expiry_days=round(tau_days, 4),
            current_iv=iv,
            dealer_gamma_regime=regime,
            total_market_gex=round(total_market_gex, 3),
            primary_pin_strike=primary_k,
            primary_pin_probability=round(primary_p_pin, 4),
            strike_profiles=profiles,
            underlying_delta_rebalance_surge_shares=round(rebalance_shares, 1),
            tactical_directive=directive,
            action_type=action,
        )
