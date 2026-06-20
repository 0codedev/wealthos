r"""Cross-Asset Order Flow Toxic Run & Flash Liquidity Drain Sieve (Domain 211 / WP-DI)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Microstructure trade run length tracker and geometric run probability P(L \ge k).
2. Dynamic Kyle's Lambda (\lambda_{Kyle}) price impact estimator measuring liquidity resilience.
3. Flash liquidity drain velocity \mathcal{V}_{drain} and book replenishment ratio \mathcal{R}_{replenish}.
4. Automated quote eviction and spread-skewing sentry to protect maker inventory against toxic sweeps.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class ToxicFlowRegime(Enum):
    """Classification of order flow toxicity and book resilience."""
    BENIGN_BALANCED_FLOW = "BENIGN_BALANCED_FLOW"         # Balanced noise flow, normal replenishment
    DIRECTIONAL_TOXIC_RUN = "DIRECTIONAL_TOXIC_RUN"       # Statistically anomalous unidirectional run
    FLASH_LIQUIDITY_VACUUM = "FLASH_LIQUIDITY_VACUUM"     # Severe depth drain, replenishment failure


class MarketMakingPosture(Enum):
    """Tactical posture for market making quotes."""
    QUOTE_BID_AND_ASK = "QUOTE_BID_AND_ASK"               # Normal two-sided quoting
    SKEW_QUOTES_AWAY = "SKEW_QUOTES_AWAY"                 # Widen adverse side, shade inventory
    PULL_ALL_RESTING_QUOTES = "PULL_ALL_RESTING_QUOTES"   # Emergency cancel all resting quotes


@dataclass
class TradeTick:
    """Individual trade execution tick."""
    timestamp_ms: float
    price: float
    size: float
    side: str                          # "BUY" (+1) or "SELL" (-1)


@dataclass
class ToxicRunDiagnosticsResult:
    """Telemetry and tactical diagnostics for toxic flow and liquidity drainage."""
    symbol: str
    current_run_length: int
    run_direction: str                 # "BUY", "SELL", or "NEUTRAL"
    run_p_value: float                 # Probability of run under null hypothesis
    cumulative_run_volume: float
    kyles_lambda_bps_per_k_shares: float
    lambda_expansion_ratio: float      # Current lambda / Baseline lambda
    liquidity_drain_velocity_shares_sec: float
    replenishment_ratio: float
    flow_regime: ToxicFlowRegime
    recommended_posture: MarketMakingPosture
    bid_quote_spread_multiplier: float # Multiplier for quoting spread
    ask_quote_spread_multiplier: float
    tactical_directive: str


class OrderFlowToxicRunSieve:
    r"""Cross-Asset Order Flow Toxic Run & Flash Liquidity Drain Sieve.
    
    Mathematical Formulation:
    1. Run Length Probability under Null Hypothesis H_0 (i.i.d. Bernoulli p=0.5):
       P(L \ge k) = 0.5^{k - 1}
    
    2. Dynamic Kyle's Lambda:
       \Delta P_t = \lambda \cdot ( \text{Flow}_t ) + \epsilon_t
       \lambda = \frac{\sum |\Delta P_i|}{\sum \sqrt{V_i}} \times 10000 \quad (\text{bps impact})
       
    3. Replenishment Ratio:
       \mathcal{R}_{replenish} = \frac{\Delta V_{rested\_additions}}{V_{aggressive\_trades} + 1e-4}
       
    4. Flash Drain Velocity:
       \mathcal{V}_{drain} = \frac{\Delta \text{Depth}_{consumed}}{\Delta t}
    """

    def __init__(
        self,
        baseline_kyles_lambda: float = 0.80, # Baseline bps per 1,000 shares
        critical_run_length: int = 6,        # k >= 6 corresponds to p <= 0.03125
        min_replenishment_ratio: float = 0.30,
    ) -> None:
        self.baseline_kyles_lambda = baseline_kyles_lambda
        self.critical_run_length = critical_run_length
        self.min_replenishment_ratio = min_replenishment_ratio

    def analyze_trade_runs(
        self,
        trades: List[TradeTick],
    ) -> Tuple[int, str, float, float]:
        """Compute the current unbroken run length, direction, p-value, and volume."""
        if not trades:
            return 0, "NEUTRAL", 1.0, 0.0

        current_side = trades[-1].side.upper()
        run_length = 0
        run_volume = 0.0

        for t in reversed(trades):
            if t.side.upper() == current_side:
                run_length += 1
                run_volume += t.size
            else:
                break

        # Under H0, probability of run length >= k is 0.5^(k-1)
        p_val = math.pow(0.5, max(0, run_length - 1))
        return run_length, current_side, round(p_val, 6), round(run_volume, 2)

    def compute_kyles_lambda(
        self,
        trades: List[TradeTick],
    ) -> float:
        """Estimate instantaneous Kyle's Lambda price impact coefficient."""
        if len(trades) < 2:
            return self.baseline_kyles_lambda

        price_changes_bps = 0.0
        sqrt_volume_sum = 0.0

        for i in range(1, len(trades)):
            prev_p = trades[i - 1].price
            curr_p = trades[i].price
            if prev_p > 0:
                bps = abs(curr_p - prev_p) / prev_p * 10000.0
                price_changes_bps += bps
                sqrt_volume_sum += math.sqrt(trades[i].size)

        if sqrt_volume_sum > 0:
            # Scaled to per 1,000 shares
            lambda_est = (price_changes_bps / sqrt_volume_sum) * math.sqrt(1000.0)
            return round(max(0.01, lambda_est), 4)
        return self.baseline_kyles_lambda

    def evaluate_flow_sieve(
        self,
        symbol: str,
        trades: List[TradeTick],
        volume_added_last_second: float,
        volume_consumed_last_second: float,
        time_window_sec: float = 1.0,
    ) -> ToxicRunDiagnosticsResult:
        """Execute toxic run detection, Kyle's lambda impact, and liquidity drain diagnostics."""
        run_len, run_dir, p_val, run_vol = self.analyze_trade_runs(trades)
        k_lambda = self.compute_kyles_lambda(trades)
        lambda_expansion = k_lambda / max(self.baseline_kyles_lambda, 0.01)

        # Replenishment ratio
        safe_consumed = max(volume_consumed_last_second, 1.0)
        replenish_ratio = volume_added_last_second / safe_consumed

        drain_velocity = safe_consumed / max(time_window_sec, 0.01)

        # Regime determination
        if replenish_ratio < self.min_replenishment_ratio and lambda_expansion > 2.2:
            regime = ToxicFlowRegime.FLASH_LIQUIDITY_VACUUM
            posture = MarketMakingPosture.PULL_ALL_RESTING_QUOTES
            bid_mult = 5.0
            ask_mult = 5.0
            directive = (
                f"FLASH VACUUM: Severe depth drain ({drain_velocity:.0f} shares/s) and replenishment failure "
                f"(R_repl={replenish_ratio:.2f}, Lambda Exp={lambda_expansion:.2f}x). Pull all resting quotes immediately!"
            )
        elif run_len >= self.critical_run_length or (run_len >= 4 and lambda_expansion > 1.8):
            regime = ToxicFlowRegime.DIRECTIONAL_TOXIC_RUN
            posture = MarketMakingPosture.SKEW_QUOTES_AWAY
            if run_dir == "BUY":
                bid_mult = 1.0   # Back off ask, widen ask spread to prevent being run over
                ask_mult = 3.0
                directive = (
                    f"TOXIC BUY RUN: {run_len} consecutive buys (p={p_val:.4f}, Vol={run_vol:.0f}). "
                    f"Widen ask spread by 3.0x to evade toxic adverse selection."
                )
            else:
                bid_mult = 3.0   # Toxic selling, widen bid spread
                ask_mult = 1.0
                directive = (
                    f"TOXIC SELL RUN: {run_len} consecutive sells (p={p_val:.4f}, Vol={run_vol:.0f}). "
                    f"Widen bid spread by 3.0x to evade toxic dump."
                )
        else:
            regime = ToxicFlowRegime.BENIGN_BALANCED_FLOW
            posture = MarketMakingPosture.QUOTE_BID_AND_ASK
            bid_mult = 1.0
            ask_mult = 1.0
            directive = (
                f"BALANCED: Order flow normal (Run={run_len} {run_dir}, Lambda Exp={lambda_expansion:.2f}x, "
                f"Replenish={replenish_ratio:.2f}). Maintain standard two-sided quotes."
            )

        return ToxicRunDiagnosticsResult(
            symbol=symbol,
            current_run_length=run_len,
            run_direction=run_dir,
            run_p_value=p_val,
            cumulative_run_volume=run_vol,
            kyles_lambda_bps_per_k_shares=k_lambda,
            lambda_expansion_ratio=round(lambda_expansion, 3),
            liquidity_drain_velocity_shares_sec=round(drain_velocity, 2),
            replenishment_ratio=round(replenish_ratio, 3),
            flow_regime=regime,
            recommended_posture=posture,
            bid_quote_spread_multiplier=bid_mult,
            ask_quote_spread_multiplier=ask_mult,
            tactical_directive=directive,
        )
