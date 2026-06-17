r"""High-Frequency Limit Order Book Co-Integration & Dynamic Pairs Hedging Engine (Domain 215 / WP-DM)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Dynamic hedge ratio \beta and intercept \alpha estimation between cointegrated asset pairs.
2. Continuous-time Ornstein-Uhlenbeck (OU) mean-reversion drift \theta, equilibrium volatility \sigma_{eq},
   and mean-reversion half-life \tau_{1/2}.
3. LOB microstructure half-spread friction filter ensuring statistical edge exceeds crossing barrier.
4. Autonomous statistical arbitrage pairs execution and cointegration breakdown stop-loss sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class PairsRegimeStatus(Enum):
    """Classification of pairs spread mean-reversion state."""
    SPREAD_EQUILIBRIUM = "SPREAD_EQUILIBRIUM"           # |Z| < 1.0, spread near equilibrium
    LONG_SPREAD_OPPORTUNITY = "LONG_SPREAD_OPPORTUNITY" # Z <= -2.0, Asset 1 underpriced vs Asset 2
    SHORT_SPREAD_OPPORTUNITY = "SHORT_SPREAD_OPPORTUNITY" # Z >= +2.0, Asset 1 overpriced vs Asset 2
    COINTEGRATION_BREAKDOWN = "COINTEGRATION_BREAKDOWN" # |Z| > 4.5 or half-life decay, broken relationship


class PairsExecutionAction(Enum):
    """Tactical execution response for pairs trading."""
    STANDBY_PASSIVE = "STANDBY_PASSIVE"
    ENTER_LONG_SPREAD = "ENTER_LONG_SPREAD"             # Buy Leg 1, Sell Leg 2
    ENTER_SHORT_SPREAD = "ENTER_SHORT_SPREAD"           # Sell Leg 1, Buy Leg 2
    CLOSE_PAIR_TAKE_PROFIT = "CLOSE_PAIR_TAKE_PROFIT"   # Unwind at mean reversion
    EMERGENCY_UNWIND_STOP = "EMERGENCY_UNWIND_STOP"     # Sever broken pair


@dataclass
class AssetQuote:
    """Top-of-book market quote for a pairs constituent."""
    symbol: str
    bid_price: float
    ask_price: float
    mid_price: float = field(init=False)

    def __post_init__(self):
        self.mid_price = 0.5 * (self.bid_price + self.ask_price)


@dataclass
class OrnsteinUhlenbeckParams:
    """Calibrated parameters of the Ornstein-Uhlenbeck process."""
    theta_mean_reversion_speed: float
    mu_long_term_mean: float
    sigma_equilibrium: float
    half_life_seconds: float
    r_squared_fit: float


@dataclass
class PairsTradingDiagnosticsResult:
    """Full quantitative diagnostics and execution directive for pairs."""
    pair_name: str
    leg_1_symbol: str
    leg_2_symbol: str
    hedge_ratio_beta: float
    current_spread: float
    spread_z_score: float
    ou_params: OrnsteinUhlenbeckParams
    gross_edge_bps: float
    total_friction_bps: float
    net_edge_bps: float
    regime: PairsRegimeStatus
    action: PairsExecutionAction
    leg_1_shares: float
    leg_2_shares: float
    tactical_directive: str


class LOBCointegrationPairsHedgingEngine:
    r"""High-Frequency LOB Cointegration & Dynamic Pairs Hedging Engine.
    
    Mathematical Formulation:
    1. Spread Definition:
       S_t = \ln(P_1) - \beta \ln(P_2) - \alpha
       
    2. Ornstein-Uhlenbeck AR(1) Discrete Calibration:
       S_t = a + b S_{t-1} + \epsilon_t
       b = \exp(-\theta \Delta t) \implies \theta = -\frac{\ln(b)}{\Delta t}
       \mu = \frac{a}{1 - b}
       \sigma_{eq} = \frac{\sigma_\epsilon}{\sqrt{1 - b^2}}
       \tau_{1/2} = \frac{\ln(2)}{\theta}
       
    3. Microstructure Friction Sieve:
       \text{Friction}_{\text{bps}} = \left( \frac{\frac{1}{2}\text{Spread}_1}{P_1} + \beta \frac{\frac{1}{2}\text{Spread}_2}{P_2} \right) \times 10000 + 2 \times \text{Fee}_{\text{taker}}
    """

    def __init__(
        self,
        entry_z_threshold: float = 2.0,
        exit_z_threshold: float = 0.5,
        breakdown_z_threshold: float = 4.5,
        max_acceptable_half_life_sec: float = 120.0,
        taker_fee_bps_per_leg: float = 0.50,
    ) -> None:
        self.entry_z = entry_z_threshold
        self.exit_z = exit_z_threshold
        self.breakdown_z = breakdown_z_threshold
        self.max_half_life = max_acceptable_half_life_sec
        self.taker_fee_bps = taker_fee_bps_per_leg

    def calibrate_ou_process(
        self,
        spread_history: List[float],
        dt_seconds: float = 1.0,
    ) -> OrnsteinUhlenbeckParams:
        """Calibrate Ornstein-Uhlenbeck parameters from historical spread timeseries."""
        if len(spread_history) < 10:
            return OrnsteinUhlenbeckParams(
                theta_mean_reversion_speed=0.01,
                mu_long_term_mean=spread_history[-1] if spread_history else 0.0,
                sigma_equilibrium=0.01,
                half_life_seconds=300.0,
                r_squared_fit=0.0,
            )

        mean_spread = sum(spread_history) / len(spread_history)
        x = [s - mean_spread for s in spread_history[:-1]]
        y = [s - mean_spread for s in spread_history[1:]]
        n = len(y)

        num = sum(x[i] * y[i] for i in range(n))
        den = sum(x[i] * x[i] for i in range(n))

        b = num / max(den, 1e-8)
        # Constrain b to [0.01, 0.99] for numerical stationarity
        b = max(0.01, min(0.99, b))

        theta = -math.log(b) / max(dt_seconds, 1e-4)
        mu = mean_spread
        half_life = math.log(2.0) / max(theta, 1e-6)

        # Residuals
        resids = [y[i] - b * x[i] for i in range(n)]
        var_eps = sum(r * r for r in resids) / max(1, n - 1)
        sigma_eps = math.sqrt(var_eps)
        sigma_eq = sigma_eps / math.sqrt(max(1e-6, 1.0 - b * b))

        # R-squared
        tot_var = sum(y[i] ** 2 for i in range(n))
        r2 = 1.0 - (sum(r * r for r in resids) / max(tot_var, 1e-8))

        return OrnsteinUhlenbeckParams(
            theta_mean_reversion_speed=round(theta, 4),
            mu_long_term_mean=round(mu, 6),
            sigma_equilibrium=round(sigma_eq, 6),
            half_life_seconds=round(half_life, 2),
            r_squared_fit=round(max(0.0, r2), 4),
        )

    def evaluate_pairs_signal(
        self,
        quote_1: AssetQuote,
        quote_2: AssetQuote,
        hedge_ratio_beta: float,
        spread_history: List[float],
        base_allocation_capital: float = 100000.0,
    ) -> PairsTradingDiagnosticsResult:
        """Run cointegration diagnostics, LOB friction barrier evaluation, and tactical action."""
        # Current log spread
        curr_spread = math.log(quote_1.mid_price) - hedge_ratio_beta * math.log(quote_2.mid_price)

        ou = self.calibrate_ou_process(spread_history)

        # Z-Score
        z = (curr_spread - ou.mu_long_term_mean) / max(ou.sigma_equilibrium, 1e-6)

        # Microstructure Friction
        half_spread_1_bps = (0.5 * (quote_1.ask_price - quote_1.bid_price) / quote_1.mid_price) * 10000.0
        half_spread_2_bps = (0.5 * (quote_2.ask_price - quote_2.bid_price) / quote_2.mid_price) * 10000.0
        crossing_friction_bps = half_spread_1_bps + half_spread_2_bps + 2.0 * self.taker_fee_bps

        # Expected gross mean-reversion profit in bps: |Z| * sigma_eq * 10000
        gross_edge_bps = abs(z) * ou.sigma_equilibrium * 10000.0
        net_edge_bps = gross_edge_bps - crossing_friction_bps

        # Sizing
        # Dollar neutral sizing: Leg 1 notional = 0.5 * Capital, Leg 2 notional = 0.5 * Capital
        leg_1_shares = (0.5 * base_allocation_capital) / quote_1.mid_price
        leg_2_shares = (0.5 * base_allocation_capital) / quote_2.mid_price

        # Regimes & Decisions
        if abs(z) >= self.breakdown_z or ou.half_life_seconds > self.max_half_life * 2.5:
            regime = PairsRegimeStatus.COINTEGRATION_BREAKDOWN
            action = PairsExecutionAction.EMERGENCY_UNWIND_STOP
            directive = (
                f"BREAKDOWN HAZARD: Spread decoupled (Z={z:+.2f}, Half-Life={ou.half_life_seconds:.1f}s). "
                f"Emergency sever pair to prevent catastrophic trend breakout."
            )
        elif z <= -self.entry_z and net_edge_bps > 0 and ou.half_life_seconds <= self.max_half_life:
            regime = PairsRegimeStatus.LONG_SPREAD_OPPORTUNITY
            action = PairsExecutionAction.ENTER_LONG_SPREAD
            directive = (
                f"LONG SPREAD ENTRY: {quote_1.symbol} undervalued vs {quote_2.symbol} (Z={z:+.2f}). "
                f"Net Edge: +{net_edge_bps:.2f} bps, Half-Life: {ou.half_life_seconds:.1f}s. Buy Leg 1 ({leg_1_shares:.0f}), Sell Leg 2 ({leg_2_shares:.0f})."
            )
        elif z >= self.entry_z and net_edge_bps > 0 and ou.half_life_seconds <= self.max_half_life:
            regime = PairsRegimeStatus.SHORT_SPREAD_OPPORTUNITY
            action = PairsExecutionAction.ENTER_SHORT_SPREAD
            directive = (
                f"SHORT SPREAD ENTRY: {quote_1.symbol} overvalued vs {quote_2.symbol} (Z={z:+.2f}). "
                f"Net Edge: +{net_edge_bps:.2f} bps, Half-Life: {ou.half_life_seconds:.1f}s. Sell Leg 1 ({leg_1_shares:.0f}), Buy Leg 2 ({leg_2_shares:.0f})."
            )
        elif abs(z) <= self.exit_z:
            regime = PairsRegimeStatus.SPREAD_EQUILIBRIUM
            action = PairsExecutionAction.CLOSE_PAIR_TAKE_PROFIT
            directive = f"EQUILIBRIUM: Spread converged near mean (Z={z:+.2f}). Take profit or hold neutral."
        else:
            regime = PairsRegimeStatus.SPREAD_EQUILIBRIUM
            action = PairsExecutionAction.STANDBY_PASSIVE
            directive = f"HOLD PASSIVE: Spread within normal band (Z={z:+.2f}, Net Edge={net_edge_bps:+.2f} bps)."

        return PairsTradingDiagnosticsResult(
            pair_name=f"{quote_1.symbol}/{quote_2.symbol}",
            leg_1_symbol=quote_1.symbol,
            leg_2_symbol=quote_2.symbol,
            hedge_ratio_beta=round(hedge_ratio_beta, 4),
            current_spread=round(curr_spread, 6),
            spread_z_score=round(z, 3),
            ou_params=ou,
            gross_edge_bps=round(gross_edge_bps, 2),
            total_friction_bps=round(crossing_friction_bps, 2),
            net_edge_bps=round(net_edge_bps, 2),
            regime=regime,
            action=action,
            leg_1_shares=round(leg_1_shares, 1),
            leg_2_shares=round(leg_2_shares, 1),
            tactical_directive=directive,
        )
