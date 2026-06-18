"""
Domain 269 / WP-FO: Cross-Exchange Crypto Mark-Index Basis Convergence & Dislocation Sentry
=============================================================================================
Institutional quantitative sentry monitoring perpetual mark-index basis convergence,
constituent spot feed depegs, artificial mark liquidation wicks, and basis mean-reversion edge.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Dict
import numpy as np


class MarkBasisRegime(str, Enum):
    EQUILIBRIUM_TIGHT_CONVERGENCE = "EQUILIBRIUM_TIGHT_CONVERGENCE"
    ARTIFICIAL_MARK_DEPEG_LIQUIDATION_HAZARD = "ARTIFICIAL_MARK_DEPEG_LIQUIDATION_HAZARD"
    INDEX_CONSTITUENT_DISLOCATION_ANOMALY = "INDEX_CONSTITUENT_DISLOCATION_ANOMALY"
    MARK_INDEX_CONVERGENCE_ARBITRAGE = "MARK_INDEX_CONVERGENCE_ARBITRAGE"


class MarkBasisDirective(str, Enum):
    MAINTAIN_NORMAL_TRADING = "MAINTAIN_NORMAL_TRADING"
    INJECT_EMERGENCY_MARGIN_PULL_RESTING = "INJECT_EMERGENCY_MARGIN_PULL_RESTING"
    RECALCULATE_SYNTHETIC_INDEX_FILTER_OUTLIER = "RECALCULATE_SYNTHETIC_INDEX_FILTER_OUTLIER"
    EXECUTE_BASIS_CONVERGENCE_CAPTURE = "EXECUTE_BASIS_CONVERGENCE_CAPTURE"


@dataclass
class SpotConstituentFeed:
    venue: str
    price: float
    weight: float
    is_active: bool = True


@dataclass
class MarkBasisAssessment:
    symbol: str
    contract_last_price: float
    mark_price: float
    clean_index_price: float
    mark_to_index_basis_bps: float
    last_to_mark_basis_bps: float
    outlier_venues: List[str]
    basis_z_score: float
    regime: MarkBasisRegime
    directive: MarkBasisDirective
    rationales: List[str] = field(default_factory=list)


class MarkIndexBasisSentry:
    """
    Monitors crypto perpetual contract Mark Price deviations from Spot Index and Last Price
    to prevent phantom liquidation wicks and harvest basis mean-reversion dislocations.
    """

    def __init__(
        self,
        phantom_mark_depeg_hurdle_bps: float = 40.0,    # 40 bps Last vs Mark triggers phantom liquidation guard
        convergence_arb_hurdle_bps: float = 25.0,       # 25 bps Mark vs Index triggers convergence arb
        constituent_outlier_threshold_bps: float = 150.0, # 150 bps spot feed deviation rejected as outlier
        z_score_hurdle: float = 2.0,                    # 2.0 sigma basis dislocation
    ):
        self.depeg_hurdle_bps = phantom_mark_depeg_hurdle_bps
        self.arb_hurdle_bps = convergence_arb_hurdle_bps
        self.outlier_bps = constituent_outlier_threshold_bps
        self.z_score_hurdle = z_score_hurdle

    def compute_clean_index(
        self,
        constituents: List[SpotConstituentFeed],
    ) -> tuple[float, List[str]]:
        """
        Computes robust constituent index price by filtering out decoupled / stale outlier feeds.
        """
        active_feeds = [c for c in constituents if c.is_active and c.price > 0]
        if not active_feeds:
            return 100.0, []

        prices = [f.price for f in active_feeds]
        median_price = float(np.median(prices))

        clean_feeds = []
        outlier_venues = []

        for f in active_feeds:
            dev_bps = abs((f.price - median_price) / median_price) * 10000.0
            if dev_bps > self.outlier_bps:
                outlier_venues.append(f.venue)
            else:
                clean_feeds.append(f)

        if not clean_feeds:
            return median_price, outlier_venues

        tot_w = sum(f.weight for f in clean_feeds)
        clean_index = sum(f.price * (f.weight / tot_w) for f in clean_feeds)
        return clean_index, outlier_venues

    def evaluate_mark_basis(
        self,
        symbol: str,
        contract_last_price: float,
        mark_price: float,
        constituents: List[SpotConstituentFeed],
        historical_basis_bps_series: Optional[List[float]] = None,
    ) -> MarkBasisAssessment:
        rationales = []
        clean_index, outlier_venues = self.compute_clean_index(constituents)

        # Basis computations in bps
        mark_to_index_bps = ((mark_price - clean_index) / clean_index) * 10000.0
        last_to_mark_bps = ((contract_last_price - mark_price) / mark_price) * 10000.0

        # Z-score of basis
        if historical_basis_bps_series and len(historical_basis_bps_series) >= 10:
            hist_arr = np.array(historical_basis_bps_series)
            mu = float(np.mean(hist_arr))
            sigma = max(1.0, float(np.std(hist_arr)))
            basis_z = (mark_to_index_bps - mu) / sigma
        else:
            basis_z = mark_to_index_bps / 10.0  # Default proxy

        # Regime & Directive Decision Logic
        if abs(last_to_mark_bps) >= self.depeg_hurdle_bps:
            regime = MarkBasisRegime.ARTIFICIAL_MARK_DEPEG_LIQUIDATION_HAZARD
            directive = MarkBasisDirective.INJECT_EMERGENCY_MARGIN_PULL_RESTING
            side = "HIGH" if last_to_mark_bps < 0 else "LOW"
            rationales.append(
                f"Phantom Mark Price dislocation on {symbol}: Contract={contract_last_price:.2f} vs "
                f"Mark={mark_price:.2f} (Dislocation={abs(last_to_mark_bps):.1f} bps >= {self.depeg_hurdle_bps:.1f} bps). "
                f"Mark is artificially {side}; resting orders face phantom liquidation wicks. "
                f"Inject emergency collateral and pull resting limit orders within the depeg corridor."
            )
        elif len(outlier_venues) > 0:
            regime = MarkBasisRegime.INDEX_CONSTITUENT_DISLOCATION_ANOMALY
            directive = MarkBasisDirective.RECALCULATE_SYNTHETIC_INDEX_FILTER_OUTLIER
            rationales.append(
                f"Corrupt index constituent detected on {symbol}: Venues {outlier_venues} deviated "
                f"> {self.outlier_bps:.1f} bps from spot median. Filtered outlier from pricing kernel; "
                f"Clean Synthetic Index={clean_index:.2f}."
            )
        elif abs(mark_to_index_bps) >= self.arb_hurdle_bps and abs(basis_z) >= self.z_score_hurdle:
            regime = MarkBasisRegime.MARK_INDEX_CONVERGENCE_ARBITRAGE
            directive = MarkBasisDirective.EXECUTE_BASIS_CONVERGENCE_CAPTURE
            leg = "Short Perp / Long Spot" if mark_to_index_bps > 0 else "Long Perp / Short Spot"
            rationales.append(
                f"Actionable Mark-Index convergence dislocation on {symbol} ({leg}): "
                f"Basis={mark_to_index_bps:+.1f} bps (Z-Score={basis_z:+.2f}). "
                f"Deploy mean-reversion basis convergence trade."
            )
        else:
            regime = MarkBasisRegime.EQUILIBRIUM_TIGHT_CONVERGENCE
            directive = MarkBasisDirective.MAINTAIN_NORMAL_TRADING
            rationales.append(
                f"Tight Mark-Index basis equilibrium on {symbol}: Basis={mark_to_index_bps:+.1f} bps, "
                f"Last-Mark spread={last_to_mark_bps:+.1f} bps. Fair value tracking intact."
            )

        return MarkBasisAssessment(
            symbol=symbol,
            contract_last_price=round(contract_last_price, 4),
            mark_price=round(mark_price, 4),
            clean_index_price=round(clean_index, 4),
            mark_to_index_basis_bps=round(mark_to_index_bps, 2),
            last_to_mark_basis_bps=round(last_to_mark_bps, 2),
            outlier_venues=outlier_venues,
            basis_z_score=round(basis_z, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
