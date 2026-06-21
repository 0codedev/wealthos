"""
Intraday Trade Size Distribution Power-Law & Hidden Iceberg Sieve
Domain 232 / Work Package WP-ED

Implements Clauset-Shalizi-Newman (2009) power-law maximum likelihood estimation (MLE),
trade size tail index tracking, and real-time limit order book hidden iceberg order
reload detection and absorption profiling.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class IcebergRegimeState(str, Enum):
    ICEBERG_BUY_ANCHOR = "ICEBERG_BUY_ANCHOR"     # Hidden buyer absorbing sell flow at bid
    ICEBERG_SELL_CEILING = "ICEBERG_SELL_CEILING" # Hidden seller dumping blocks at ask
    NORMAL_POWER_LAW = "NORMAL_POWER_LAW"         # Organic Pareto trade distribution, no icebergs


@dataclass
class TradeTick:
    price: float
    size: float
    timestamp: float
    is_buyer_maker: bool  # True if passive maker was buyer (sell market order)


@dataclass
class PowerLawFit:
    alpha_tail_index: float
    std_error: float
    s_min: float
    sample_size: int
    is_heavy_tailed: bool


@dataclass
class IcebergDetection:
    price_level: float
    side: str  # "buy" (bid anchor) or "sell" (ask ceiling)
    reload_count: int
    total_absorbed_volume: float
    estimated_tranche_size: float
    absorption_ratio: float
    is_active: bool


@dataclass
class IcebergSentryDecision:
    power_law: PowerLawFit
    active_icebergs: List[IcebergDetection]
    regime: IcebergRegimeState
    recommended_action: str
    details: Dict[str, float] = field(default_factory=dict)


class PowerLawIcebergSieve:
    """
    Fits Clauset-Shalizi-Newman power laws to trade volumes and tracks
    hidden iceberg order replenishment patterns across order book price levels.
    """

    def __init__(
        self,
        min_absorption_ratio: float = 2.5, # Volume executed >= 2.5x displayed slice
        max_reload_latency_sec: float = 0.50, # Sub-second automated replenishment
        min_reloads: int = 3,
    ):
        self.min_absorption = min_absorption_ratio
        self.max_reload_latency = max_reload_latency_sec
        self.min_reloads = min_reloads

    @staticmethod
    def fit_power_law_tail(
        trade_sizes: List[float],
        s_min: Optional[float] = None,
    ) -> PowerLawFit:
        """
        Fits continuous power law p(s) = (alpha - 1)/s_min * (s / s_min)^(-alpha)
        via Clauset, Shalizi, Newman (2009) Maximum Likelihood Estimator:
        alpha = 1 + n / [sum(ln(s_i / s_min))]
        """
        if not trade_sizes or len(trade_sizes) < 10:
            return PowerLawFit(alpha_tail_index=2.5, std_error=0.5, s_min=1.0, sample_size=len(trade_sizes), is_heavy_tailed=True)

        sorted_sizes = sorted(trade_sizes)
        # If s_min not provided, default to 30th percentile
        if s_min is None:
            idx = int(0.30 * len(sorted_sizes))
            cutoff = max(1e-4, sorted_sizes[idx])
        else:
            cutoff = max(1e-4, s_min)

        tail_data = [s for s in sorted_sizes if s >= cutoff]
        n = len(tail_data)

        if n < 5:
            return PowerLawFit(alpha_tail_index=2.5, std_error=0.5, s_min=cutoff, sample_size=n, is_heavy_tailed=True)

        log_sum = sum(math.log(s / cutoff) for s in tail_data)
        if log_sum <= 1e-12:
            alpha = 3.0
            se = 0.5
        else:
            alpha = 1.0 + n / log_sum
            se = (alpha - 1.0) / math.sqrt(n)

        # In financial markets: alpha < 3.0 indicates fat tails / Pareto distribution
        is_heavy = alpha < 3.2

        return PowerLawFit(
            alpha_tail_index=alpha,
            std_error=se,
            s_min=cutoff,
            sample_size=n,
            is_heavy_tailed=is_heavy,
        )

    def detect_icebergs(
        self,
        trades: List[TradeTick],
    ) -> List[IcebergDetection]:
        """
        Scans trade stream to detect hidden iceberg orders resting at discrete price levels.
        Groups fills by price and measures repetitive tranche replenishments.
        """
        if len(trades) < 5:
            return []

        # Group trades by price level and maker side
        # Key: (price, is_buyer_maker)
        price_groups: Dict[Tuple[float, bool], List[TradeTick]] = {}
        for t in trades:
            key = (t.price, t.is_buyer_maker)
            if key not in price_groups:
                price_groups[key] = []
            price_groups[key].append(t)

        detected_icebergs: List[IcebergDetection] = []

        for (price, is_buyer_maker), t_list in price_groups.items():
            if len(t_list) < self.min_reloads:
                continue

            # Sort chronologically
            t_list = sorted(t_list, key=lambda x: x.timestamp)
            sizes = [t.size for t in t_list]
            total_vol = sum(sizes)

            # Modal or median trade size as estimated visible tranche size
            median_size = sorted(sizes)[len(sizes) // 2]
            if median_size <= 0.0:
                continue

            absorption_ratio = total_vol / median_size

            # Check reload timing: fast consecutive arrivals at identical price
            reloads = 0
            for i in range(1, len(t_list)):
                dt = t_list[i].timestamp - t_list[i - 1].timestamp
                if dt <= self.max_reload_latency:
                    reloads += 1

            if reloads >= self.min_reloads and absorption_ratio >= self.min_absorption:
                side_str = "buy" if is_buyer_maker else "sell"
                detected_icebergs.append(IcebergDetection(
                    price_level=price,
                    side=side_str,
                    reload_count=reloads,
                    total_absorbed_volume=total_vol,
                    estimated_tranche_size=median_size,
                    absorption_ratio=absorption_ratio,
                    is_active=True,
                ))

        return detected_icebergs

    def evaluate_order_flow_structure(
        self,
        trades: List[TradeTick],
    ) -> IcebergSentryDecision:
        """
        Evaluates trade size distribution tail exponent and scans for active iceberg anchors.
        """
        sizes = [t.size for t in trades]
        power_law = self.fit_power_law_tail(sizes)
        icebergs = self.detect_icebergs(trades)

        # Classify regime
        buy_icebergs = [ice for ice in icebergs if ice.side == "buy"]
        sell_icebergs = [ice for ice in icebergs if ice.side == "sell"]

        if buy_icebergs and not sell_icebergs:
            top_buy = max(buy_icebergs, key=lambda x: x.total_absorbed_volume)
            regime = IcebergRegimeState.ICEBERG_BUY_ANCHOR
            action = (
                f"BUY_ANCHOR_DETECTED: Hidden buyer at {top_buy.price_level:.2f} "
                f"absorbed {top_buy.total_absorbed_volume:.1f} units ({top_buy.absorption_ratio:.1f}x tranche). "
                f"Front-run bid, do not short."
            )
        elif sell_icebergs and not buy_icebergs:
            top_sell = max(sell_icebergs, key=lambda x: x.total_absorbed_volume)
            regime = IcebergRegimeState.ICEBERG_SELL_CEILING
            action = (
                f"SELL_CEILING_DETECTED: Hidden seller at {top_sell.price_level:.2f} "
                f"dumped {top_sell.total_absorbed_volume:.1f} units ({top_sell.absorption_ratio:.1f}x tranche). "
                f"Exit longs, hard ceiling."
            )
        elif buy_icebergs and sell_icebergs:
            regime = IcebergRegimeState.ICEBERG_BUY_ANCHOR
            action = "TWO_SIDED_ICEBERGS: Active institutional reloads on both bid and ask. Market trapped in bracket."
        else:
            regime = IcebergRegimeState.NORMAL_POWER_LAW
            action = f"ORGANIC_FLOW: Trade sizes follow power-law alpha={power_law.alpha_tail_index:.2f}. No active hidden icebergs."

        return IcebergSentryDecision(
            power_law=power_law,
            active_icebergs=icebergs,
            regime=regime,
            recommended_action=action,
            details={
                "alpha_tail_index": power_law.alpha_tail_index,
                "power_law_std_error": power_law.std_error,
                "num_icebergs_detected": float(len(icebergs)),
            },
        )
