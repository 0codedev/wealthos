"""
High-Frequency Limit Order Book Multi-Level Hawkes Clustering & Flash Replenishment Engine
Domain 241 / Work Package WP-EM

Models high-frequency limit order book event microdynamics (inserts vs cancels) using
a 4-dimensional multivariate Hawkes self- and cross-exciting point process,
computes the Flash Replenishment Ratio (FRR), and prevents maker queue evaporation.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class LOBEventType(str, Enum):
    BID_INSERT = "BID_INSERT"    # Index 0
    ASK_INSERT = "ASK_INSERT"    # Index 1
    BID_CANCEL = "BID_CANCEL"    # Index 2
    ASK_CANCEL = "ASK_CANCEL"    # Index 3


class LOBClusteringRegimeState(str, Enum):
    RESILIENT_REPLENISHMENT = "RESILIENT_REPLENISHMENT"        # Fast replenishment, high FRR, resilient depth
    EVAPORATION_CLUSTER_WARNING = "EVAPORATION_CLUSTER_WARNING"# Cancels dominating inserts, thinning order book
    FLASH_CANCELLATION_CASCADE = "FLASH_CANCELLATION_CASCADE"  # Supercritical cancel avalanche, air-pocket danger
    TRANQUIL_LOW_FLOW = "TRANQUIL_LOW_FLOW"                    # Low frequency, baseline Poisson state


class LOBReplenishmentDirective(str, Enum):
    QUOTE_AGGRESSIVE_TOP_OF_BOOK = "QUOTE_AGGRESSIVE_TOP_OF_BOOK" # Resilient book, tight spread, capture rebate
    WIDEN_TO_DEEP_LEVELS = "WIDEN_TO_DEEP_LEVELS"                # Pull to level 3-5 to dodge queue evaporation
    EMERGENCY_EVACUATE_QUOTES = "EMERGENCY_EVACUATE_QUOTES"      # Immediate cancellation of all resting maker quotes
    MAINTAIN_STANDARD_SPREAD = "MAINTAIN_STANDARD_SPREAD"        # Standard market making spread buffer


@dataclass
class LOBEvent:
    event_type: LOBEventType
    timestamp_sec: float
    price: float
    size: float


@dataclass
class HawkesKernelMatrix:
    alpha_matrix: List[List[float]]
    beta: float
    branching_matrix: List[List[float]]
    spectral_radius: float
    flash_replenishment_ratio: float  # (alpha_inserts / alpha_cancels)


@dataclass
class ReplenishmentAssessment:
    timestamp_sec: float
    event_count_window: int
    spectral_radius: float
    flash_replenishment_ratio: float
    state: LOBClusteringRegimeState
    directive: LOBReplenishmentDirective
    spread_multiplier: float
    rationales: List[str] = field(default_factory=list)


class LOBHawkesClusteringEngine:
    """
    Analyzes microstructural point-process clustering across bid/ask insertions and
    cancellations, detecting sudden evaporation cascades before market sweeps occur.
    """

    EVENT_INDEX = {
        LOBEventType.BID_INSERT: 0,
        LOBEventType.ASK_INSERT: 1,
        LOBEventType.BID_CANCEL: 2,
        LOBEventType.ASK_CANCEL: 3,
    }

    def __init__(
        self,
        decay_beta: float = 10.0,              # Fast decay for sub-second microstructure (half-life ~70ms)
        min_events_threshold: int = 8,
        cascade_spectral_threshold: float = 0.92,
        evaporation_frr_threshold: float = 0.75,
        resilient_frr_threshold: float = 1.35,
    ):
        self.decay_beta = decay_beta
        self.min_events_threshold = min_events_threshold
        self.cascade_spectral_threshold = cascade_spectral_threshold
        self.evaporation_frr_threshold = evaporation_frr_threshold
        self.resilient_frr_threshold = resilient_frr_threshold

    def calculate_spectral_radius(self, matrix: List[List[float]], max_iter: int = 40) -> float:
        """Computes Perron-Frobenius spectral radius of 4x4 branching matrix via power iteration."""
        n = len(matrix)
        if n == 0:
            return 0.0
        v = [1.0 / math.sqrt(n)] * n
        for _ in range(max_iter):
            w = [0.0] * n
            for i in range(n):
                for j in range(n):
                    w[i] += matrix[i][j] * v[j]
            norm = math.sqrt(sum(x * x for x in w))
            if norm < 1e-12:
                return 0.0
            v = [x / norm for x in w]
        mv = [0.0] * n
        for i in range(n):
            for j in range(n):
                mv[i] += matrix[i][j] * v[j]
        eigenvalue = sum(v[i] * mv[i] for i in range(n))
        return max(0.0, eigenvalue)

    def calibrate_kernel(
        self,
        events: List[LOBEvent],
        current_time_sec: float,
        window_sec: float = 2.0,
    ) -> HawkesKernelMatrix:
        """
        Calibrates the 4x4 Hawkes cross-excitation matrix from recent order book events:
        Counts consecutive pairwise transitions weighted by exponential memory decay.
        """
        # Filter window
        recent = [e for e in events if (current_time_sec - e.timestamp_sec) <= window_sec]

        # Initialize base 4x4 alpha matrix
        # indices: 0: Bid Insert, 1: Ask Insert, 2: Bid Cancel, 3: Ask Cancel
        alpha = [[0.8 for _ in range(4)] for _ in range(4)]

        # Accumulate empirical cross-event excitation
        for i in range(len(recent)):
            e_curr = recent[i]
            idx_curr = self.EVENT_INDEX[e_curr.event_type]
            for j in range(max(0, i - 15), i):
                e_prev = recent[j]
                idx_prev = self.EVENT_INDEX[e_prev.event_type]
                dt = e_curr.timestamp_sec - e_prev.timestamp_sec
                if 0.0 < dt <= window_sec:
                    # Increment cross-excitation weight decayed by beta
                    weight = math.exp(-self.decay_beta * dt)
                    alpha[idx_curr][idx_prev] += weight * 0.40

        # Construct branching matrix Gamma_ij = alpha_ij / beta
        branching = [[alpha[i][j] / self.decay_beta for j in range(4)] for i in range(4)]
        spec_rad = self.calculate_spectral_radius(branching)

        # Flash Replenishment Ratio (FRR):
        # Average excitation towards inserts (rows 0, 1) vs towards cancels (rows 2, 3)
        insert_excitation = (sum(alpha[0]) + sum(alpha[1])) / 2.0
        cancel_excitation = (sum(alpha[2]) + sum(alpha[3])) / 2.0
        frr = insert_excitation / max(1e-4, cancel_excitation)

        return HawkesKernelMatrix(
            alpha_matrix=alpha,
            beta=self.decay_beta,
            branching_matrix=branching,
            spectral_radius=round(spec_rad, 4),
            flash_replenishment_ratio=round(frr, 4),
        )

    def evaluate(
        self,
        events: List[LOBEvent],
        current_time_sec: float,
        window_sec: float = 2.0,
    ) -> ReplenishmentAssessment:
        """
        Synthesizes Hawkes excitation dynamics into actionable market making spread directives.
        """
        rationales: List[str] = []
        recent = [e for e in events if (current_time_sec - e.timestamp_sec) <= window_sec]
        n_events = len(recent)

        if n_events < self.min_events_threshold:
            return ReplenishmentAssessment(
                timestamp_sec=current_time_sec,
                event_count_window=n_events,
                spectral_radius=0.30,
                flash_replenishment_ratio=1.0,
                state=LOBClusteringRegimeState.TRANQUIL_LOW_FLOW,
                directive=LOBReplenishmentDirective.MAINTAIN_STANDARD_SPREAD,
                spread_multiplier=1.0,
                rationales=["Order flow tranquil, event count below calibration threshold."],
            )

        kernel = self.calibrate_kernel(events, current_time_sec, window_sec)
        rho = kernel.spectral_radius
        frr = kernel.flash_replenishment_ratio

        # Count cancels in window
        cancel_count = sum(1 for e in recent if e.event_type in [LOBEventType.BID_CANCEL, LOBEventType.ASK_CANCEL])
        cancel_ratio = cancel_count / n_events

        # Decision State Logic
        # 1. Supercritical flash cancellation cascade
        if rho >= self.cascade_spectral_threshold and cancel_ratio >= 0.50:
            state = LOBClusteringRegimeState.FLASH_CANCELLATION_CASCADE
            directive = LOBReplenishmentDirective.EMERGENCY_EVACUATE_QUOTES
            spread_mult = 3.5
            rationales.append(
                f"Flash cancellation cascade detected (spectral radius rho={rho:.3f} >= {self.cascade_spectral_threshold:.2f}, cancel ratio={cancel_ratio*100:.1f}%). Evacuate maker quotes immediately."
            )

        # 2. Evaporation cluster warning
        elif frr <= self.evaporation_frr_threshold or cancel_ratio >= 0.60:
            state = LOBClusteringRegimeState.EVAPORATION_CLUSTER_WARNING
            directive = LOBReplenishmentDirective.WIDEN_TO_DEEP_LEVELS
            spread_mult = 2.0
            rationales.append(
                f"Queue evaporation clustering (FRR={frr:.2f} <= {self.evaporation_frr_threshold:.2f}, cancel ratio={cancel_ratio*100:.1f}%). Widen quotes to deep levels (depth buffer 2.0x)."
            )

        # 3. Resilient replenishment
        elif frr >= self.resilient_frr_threshold and rho < 0.80:
            state = LOBClusteringRegimeState.RESILIENT_REPLENISHMENT
            directive = LOBReplenishmentDirective.QUOTE_AGGRESSIVE_TOP_OF_BOOK
            spread_mult = 0.8
            rationales.append(
                f"Order book resilient with rapid replenishment (FRR={frr:.2f} >= {self.resilient_frr_threshold:.2f}, rho={rho:.3f}). Aggressive top-of-book quoting safe."
            )

        # 4. Standard tranquil
        else:
            state = LOBClusteringRegimeState.TRANQUIL_LOW_FLOW
            directive = LOBReplenishmentDirective.MAINTAIN_STANDARD_SPREAD
            spread_mult = 1.0
            rationales.append(
                f"Equilibrium flow dynamics (FRR={frr:.2f}, rho={rho:.3f}). Standard quoting spreads maintained."
            )

        return ReplenishmentAssessment(
            timestamp_sec=current_time_sec,
            event_count_window=n_events,
            spectral_radius=rho,
            flash_replenishment_ratio=frr,
            state=state,
            directive=directive,
            spread_multiplier=spread_mult,
            rationales=rationales,
        )
