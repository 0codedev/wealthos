"""
Cross-Asset Options Cross-GEX Imbalance & Forced Feedback Squeeze Sentry
Domain 224 / Work Package WP-DV

Institutional market maker gamma exposure (GEX) profiling, cross-asset index vs
constituent dislocation analytics, dealer delta-hedging feedback flow estimation,
and non-linear options gamma squeeze sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class SentryAlertState(str, Enum):
    NORMAL_DAMPENED = "NORMAL_DAMPENED"          # Positive dealer gamma, market moves dampened
    VOLATILITY_EXPANSION = "VOLATILITY_EXPANSION" # Negative dealer gamma, accelerated volatility
    FEEDBACK_CASCADE_UP = "FEEDBACK_CASCADE_UP"    # Severe short call gamma squeeze upwards
    FEEDBACK_CASCADE_DOWN = "FEEDBACK_CASCADE_DOWN"# Severe short put gamma cascade downwards
    PIN_RISK_LOCK = "PIN_RISK_LOCK"              # 0DTE/1DTE strike pinning friction


@dataclass
class OptionContract:
    strike: float
    option_type: str  # "call" or "put"
    open_interest: float
    spot: float
    iv: float  # implied volatility annualized (e.g. 0.20)
    time_to_expiry: float  # in years (e.g. 1/365 for 1DTE)
    multiplier: float = 100.0
    dealer_is_net_long: Optional[bool] = None  # None = infer standard retail-long / dealer-short assumption


@dataclass
class GEXProfile:
    spot: float
    net_gex_usd: float
    call_gex_usd: float
    put_gex_usd: float
    gamma_flip_price: Optional[float]
    dealer_gamma_per_dollar: float
    pin_strike: Optional[float]
    max_gamma_strike: float


@dataclass
class SentryDecision:
    alert_state: SentryAlertState
    net_gex_usd: float
    flip_distance_pct: float
    projected_hedge_flow_usd: float
    feedback_ratio: float
    pin_risk_detected: bool
    recommended_action: str
    details: Dict[str, float] = field(default_factory=dict)


class CrossGEXSqueezeSentry:
    """
    Evaluates dealer gamma positioning across single-stock and index options.
    Detects when dealer delta-hedging creates unabsorbable market order flow.
    """

    def __init__(self, risk_free_rate: float = 0.05, critical_feedback_ratio: float = 1.25):
        self.r = risk_free_rate
        self.critical_feedback_ratio = critical_feedback_ratio

    @staticmethod
    def compute_bs_gamma(
        spot: float, strike: float, time_to_expiry: float, iv: float, r: float = 0.05
    ) -> float:
        """
        Analytical Black-Scholes gamma: Gamma = N'(d1) / (S * sigma * sqrt(T))
        Guarded against division by zero as T -> 0 or iv -> 0.
        """
        if spot <= 0.0 or strike <= 0.0:
            return 0.0

        t = max(time_to_expiry, 1e-5)
        sigma = max(iv, 1e-4)

        sqrt_t = math.sqrt(t)
        sigma_sqrt_t = sigma * sqrt_t

        d1 = (math.log(spot / strike) + (r + 0.5 * sigma * sigma) * t) / sigma_sqrt_t
        phi_d1 = (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * d1 * d1)

        gamma = phi_d1 / (spot * sigma_sqrt_t)
        return gamma

    def compute_contract_gex(self, contract: OptionContract, spot_override: Optional[float] = None) -> float:
        """
        Computes dollar GEX for an option contract.
        Dollar GEX = Gamma * Spot^2 * OI * Multiplier * DealerDirectionSign
        Standard institutional dealer convention:
          Retail buys calls -> Dealers short calls -> Dealer Gamma < 0 (or convention: dealer long calls positive, short puts negative).
          By market standard:
          Dealers are assumed Long Calls (positive GEX: buying dips, selling rips)
          Dealers are assumed Short Puts (negative GEX: selling into dips, buying rips)
          If dealer_is_net_long is explicitly specified, it overrides convention.
        """
        s = spot_override if spot_override is not None else contract.spot
        gamma = self.compute_bs_gamma(s, contract.strike, contract.time_to_expiry, contract.iv, self.r)

        # Dollar Gamma: $ exposure per 1% or 1-point move. Standard dollar gamma is Gamma * S^2 * OI * multiplier
        raw_dollar_gamma = gamma * (s ** 2) * contract.open_interest * contract.multiplier

        if contract.dealer_is_net_long is not None:
            sign = 1.0 if contract.dealer_is_net_long else -1.0
        else:
            # Standard retail-call-buy / retail-put-buy market-making convention:
            # When retail buys calls, dealers are short calls (-1)
            # When retail buys puts, dealers are short puts (-1)
            # BUT standard GEX metric convention (SpotGamma / SqueezeMetrics):
            # Net GEX = Call GEX - Put GEX, where Call GEX is positive for market stability and Put GEX is negative
            if contract.option_type.lower() == "call":
                sign = 1.0
            else:
                sign = -1.0

        return raw_dollar_gamma * sign

    def compute_profile(
        self,
        contracts: List[OptionContract],
        current_spot: float,
        spot_range_pct: float = 0.08,
        num_grid_points: int = 41,
    ) -> GEXProfile:
        """
        Calculates the GEX profile across a range of underlying spot prices
        and locates the exact Gamma Flip Point (where Net GEX crosses zero).
        """
        if not contracts:
            return GEXProfile(
                spot=current_spot,
                net_gex_usd=0.0,
                call_gex_usd=0.0,
                put_gex_usd=0.0,
                gamma_flip_price=None,
                dealer_gamma_per_dollar=0.0,
                pin_strike=None,
                max_gamma_strike=current_spot,
            )

        # Current Spot GEX calculation
        call_gex = 0.0
        put_gex = 0.0
        strike_gammas: Dict[float, float] = {}

        for c in contracts:
            cgex = self.compute_contract_gex(c, spot_override=current_spot)
            if c.option_type.lower() == "call":
                call_gex += cgex
            else:
                put_gex += cgex

            # Track strike concentration
            gamma = self.compute_bs_gamma(current_spot, c.strike, c.time_to_expiry, c.iv, self.r)
            strike_gammas[c.strike] = strike_gammas.get(c.strike, 0.0) + gamma * c.open_interest * c.multiplier

        net_gex = call_gex + put_gex

        # Find max gamma strike and potential pin strike
        max_gamma_strike = max(strike_gammas, key=strike_gammas.get) if strike_gammas else current_spot

        # Pin strike candidate: only contracts expiring within 3 days (0DTE-3DTE) within 1.5% of spot
        expiring_gammas: Dict[float, float] = {}
        for c in contracts:
            if c.time_to_expiry <= 3.0 / 365.0 and abs(c.strike - current_spot) / current_spot <= 0.015:
                gamma = self.compute_bs_gamma(current_spot, c.strike, c.time_to_expiry, c.iv, self.r)
                expiring_gammas[c.strike] = expiring_gammas.get(c.strike, 0.0) + gamma * c.open_interest * c.multiplier

        pin_strike = max(expiring_gammas, key=expiring_gammas.get) if expiring_gammas else None

        # Sweep spot prices to identify gamma flip
        min_spot = current_spot * (1.0 - spot_range_pct)
        max_spot = current_spot * (1.0 + spot_range_pct)
        step = (max_spot - min_spot) / max(1, num_grid_points - 1)

        grid_spots = [min_spot + i * step for i in range(num_grid_points)]
        grid_gex: List[Tuple[float, float]] = []

        for s in grid_spots:
            tot_g = sum(self.compute_contract_gex(c, spot_override=s) for c in contracts)
            grid_gex.append((s, tot_g))

        # Interpolate zero crossing
        flip_price = None
        for i in range(len(grid_gex) - 1):
            s1, g1 = grid_gex[i]
            s2, g2 = grid_gex[i + 1]
            if (g1 <= 0.0 and g2 >= 0.0) or (g1 >= 0.0 and g2 <= 0.0):
                # Linear interpolation
                if abs(g2 - g1) > 1e-9:
                    flip_price = s1 - g1 * (s2 - s1) / (g2 - g1)
                else:
                    flip_price = (s1 + s2) / 2.0
                break

        # Total dealer gamma per dollar = net_gex / (current_spot^2)
        dealer_gamma_per_dollar = net_gex / (current_spot ** 2) if current_spot > 0 else 0.0

        return GEXProfile(
            spot=current_spot,
            net_gex_usd=net_gex,
            call_gex_usd=call_gex,
            put_gex_usd=put_gex,
            gamma_flip_price=flip_price,
            dealer_gamma_per_dollar=dealer_gamma_per_dollar,
            pin_strike=pin_strike,
            max_gamma_strike=max_gamma_strike,
        )

    def evaluate_cross_asset_dislocation(
        self,
        index_net_gex: float,
        constituent_net_gex_map: Dict[str, float],
        constituent_weights: Dict[str, float],
    ) -> Dict[str, float]:
        """
        Computes the Cross-Asset GEX Dislocation between an index and its weighted constituent basket.
        Dislocation Delta = Index GEX - Sum(w_i * Constituent GEX_i)
        """
        synthetic_basket_gex = 0.0
        for symbol, weight in constituent_weights.items():
            comp_gex = constituent_net_gex_map.get(symbol, 0.0)
            synthetic_basket_gex += weight * comp_gex

        dislocation_usd = index_net_gex - synthetic_basket_gex
        denom = max(abs(index_net_gex), abs(synthetic_basket_gex), 1.0)
        relative_dislocation_pct = (dislocation_usd / denom) * 100.0

        return {
            "index_net_gex": index_net_gex,
            "synthetic_basket_gex": synthetic_basket_gex,
            "dislocation_usd": dislocation_usd,
            "relative_dislocation_pct": relative_dislocation_pct,
        }

    def assess_squeeze_risk(
        self,
        contracts: List[OptionContract],
        current_spot: float,
        order_book_depth_top3_usd: float,
        price_shock_pct: float = 0.01,  # 1% simulated spot move
    ) -> SentryDecision:
        """
        Evaluates immediate squeeze risk and generates sentry alerts based on
        dealer hedging feedback vs available market depth.
        """
        profile = self.compute_profile(contracts, current_spot)

        # Delta hedging flow required for a given price shock
        # dDelta = Gamma * dS
        # Hedge Dollar Flow = Net GEX USD * (price_shock_pct)
        # Note: If GEX is positive, dealers hedge AGAINST the move (stabilizing liquidity provider).
        # If GEX is negative, dealers hedge WITH the move (destabilizing liquidity consumer).
        projected_hedge_flow_usd = abs(profile.net_gex_usd * price_shock_pct)

        effective_depth = max(order_book_depth_top3_usd, 1.0)
        feedback_ratio = projected_hedge_flow_usd / effective_depth

        # Flip distance
        if profile.gamma_flip_price is not None and current_spot > 0:
            flip_distance_pct = ((current_spot - profile.gamma_flip_price) / current_spot) * 100.0
        else:
            flip_distance_pct = 0.0

        # Pin risk check: if spot within 0.35% of high gamma pin strike with short expiry (< 2 days)
        pin_risk_detected = False
        if profile.pin_strike is not None:
            dist_to_pin = abs(current_spot - profile.pin_strike) / current_spot
            if dist_to_pin <= 0.0035:
                pin_risk_detected = True

        # Sentry state decision
        if pin_risk_detected and abs(profile.net_gex_usd) > 0:
            state = SentryAlertState.PIN_RISK_LOCK
            action = f"LOCK_BAND_HEDGING: Spot pinned at {profile.pin_strike:.2f}. Exploit mean-reversion."
        elif profile.net_gex_usd < 0:
            # Negative dealer gamma territory
            if feedback_ratio >= self.critical_feedback_ratio:
                # Feedback cascade
                if flip_distance_pct < -2.0:
                    state = SentryAlertState.FEEDBACK_CASCADE_DOWN
                    action = "CRITICAL_PUT_CASCADE: Deep negative gamma liquidation. Hedge long delta immediately."
                else:
                    state = SentryAlertState.FEEDBACK_CASCADE_UP
                    action = "CRITICAL_CALL_SQUEEZE: Dealer short squeeze forced buying. Front-run upside delta."
            else:
                state = SentryAlertState.VOLATILITY_EXPANSION
                action = "WIDEN_MAKER_SPREADS: Dealer gamma negative, elevated intraday realized volatility."
        else:
            state = SentryAlertState.NORMAL_DAMPENED
            action = "MAKER_QUOTE_TIGHT: Dealer gamma positive, mean-reverting dampened regime."

        return SentryDecision(
            alert_state=state,
            net_gex_usd=profile.net_gex_usd,
            flip_distance_pct=flip_distance_pct,
            projected_hedge_flow_usd=projected_hedge_flow_usd,
            feedback_ratio=feedback_ratio,
            pin_risk_detected=pin_risk_detected,
            recommended_action=action,
            details={
                "call_gex_usd": profile.call_gex_usd,
                "put_gex_usd": profile.put_gex_usd,
                "gamma_flip_price": profile.gamma_flip_price or 0.0,
                "max_gamma_strike": profile.max_gamma_strike,
                "effective_depth_usd": effective_depth,
            },
        )
