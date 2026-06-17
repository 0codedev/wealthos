"""
Multi-Asset Intraday Liquidity Co-Jumps & Hawkes Branching Contagion Sentry
Domain 238 / Work Package WP-EJ

Models cross-asset liquidity dislocations, synchronized spread widening co-jumps,
and systemic flash crash cascades using multivariate Hawkes self- and cross-exciting
point processes and branching matrix spectral radius analysis.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class CoJumpRegimeState(str, Enum):
    TRANQUIL_STABLE = "TRANQUIL_STABLE"                      # Subcritical branching, low co-jump intensity
    LOCALIZED_CONTAINED_SHOCK = "LOCALIZED_CONTAINED_SHOCK"  # Idiosyncratic single-asset spread blowout
    SYSTEMIC_COJUMP_CLUSTER = "SYSTEMIC_COJUMP_CLUSTER"      # Cross-asset contagion escalating, branching > 0.70
    SUPERCRITICAL_FLASH_CRASH_RUN = "SUPERCRITICAL_FLASH_CRASH_RUN" # Spectral radius >= 1.0, explosive liquidity cascade


class LiquidityCircuitDirective(str, Enum):
    MAINTAIN_NORMAL_QUOTING = "MAINTAIN_NORMAL_QUOTING"      # Standard maker liquidity provisioning
    WIDEN_LOCAL_SPREADS = "WIDEN_LOCAL_SPREADS"              # Widen quotes for shocked asset only
    THROTTLE_CROSS_CORRELATION_RISK = "THROTTLE_CROSS_CORRELATION_RISK" # Reduce inventory caps across correlated basket
    EMERGENCY_GLOBAL_CIRCUIT_PULL = "EMERGENCY_GLOBAL_CIRCUIT_PULL"     # Hard circuit breaker: cancel all quotes across all venues


@dataclass
class LiquidityEvent:
    asset: str
    timestamp_sec: float
    spread_zscore: float
    depth_drop_pct: float


@dataclass
class BranchingMatrixAnalysis:
    assets: List[str]
    branching_matrix: List[List[float]]
    spectral_radius: float
    is_supercritical: bool
    dominant_contagion_node: str


@dataclass
class CoJumpContagionAssessment:
    timestamp_sec: float
    active_cojumps_count: int
    spectral_radius: float
    regime: CoJumpRegimeState
    directive: LiquidityCircuitDirective
    shocked_assets: List[str]
    systemic_risk_score: float  # 0.0 to 1.0
    rationales: List[str] = field(default_factory=list)


class LiquidityCoJumpHawkesSentry:
    """
    Evaluates multi-asset order book liquidity jumps, tracks cross-excitation
    intensity via multivariate Hawkes dynamics, and halts quoting before explosive
    flash crash cascades materialize.
    """

    def __init__(
        self,
        jump_zscore_threshold: float = 3.0,
        jump_depth_threshold_pct: float = 0.60,
        sync_window_sec: float = 0.50,
        baseline_decay_beta: float = 2.0,
        supercritical_threshold: float = 0.95,
    ):
        self.jump_zscore_threshold = jump_zscore_threshold
        self.jump_depth_threshold_pct = jump_depth_threshold_pct
        self.sync_window_sec = sync_window_sec
        self.baseline_decay_beta = baseline_decay_beta
        self.supercritical_threshold = supercritical_threshold

    def is_liquidity_jump(self, spread_zscore: float, depth_drop_pct: float) -> bool:
        """Determines if a microstructure dislocation qualifies as a discrete liquidity jump."""
        return (spread_zscore >= self.jump_zscore_threshold) or (depth_drop_pct >= self.jump_depth_threshold_pct)

    def calculate_spectral_radius(self, matrix: List[List[float]], max_iter: int = 50) -> Tuple[float, List[float]]:
        """
        Computes the spectral radius (Perron-Frobenius dominant eigenvalue)
        and associated eigenvector of non-negative branching matrix via power iteration.
        """
        n = len(matrix)
        if n == 0:
            return 0.0, []
        if n == 1:
            return matrix[0][0], [1.0]

        # Initial uniform vector
        v = [1.0 / math.sqrt(n)] * n

        for _ in range(max_iter):
            w = [0.0] * n
            for i in range(n):
                for j in range(n):
                    w[i] += matrix[i][j] * v[j]
            norm = math.sqrt(sum(x * x for x in w))
            if norm < 1e-12:
                return 0.0, v
            v = [x / norm for x in w]

        # Rayleigh quotient for dominant eigenvalue: v' M v / (v' v)
        mv = [0.0] * n
        for i in range(n):
            for j in range(n):
                mv[i] += matrix[i][j] * v[j]
        eigenvalue = sum(v[i] * mv[i] for i in range(n))
        return max(0.0, eigenvalue), v

    def build_branching_matrix(
        self,
        assets: List[str],
        recent_events: List[LiquidityEvent],
        current_time_sec: float,
        alpha_self_base: float = 0.25,
        alpha_cross_base: float = 0.15,
    ) -> BranchingMatrixAnalysis:
        """
        Constructs the empirical multivariate branching matrix Gamma_ij = alpha_ij / beta_ij.
        Adjusts cross-excitation weights dynamically based on synchronous co-jumps.
        """
        n = len(assets)
        asset_map = {asset: i for i, asset in enumerate(assets)}

        # Count jumps per asset and co-jumps between asset pairs in recent memory
        jump_counts = [0] * n
        pair_cojumps = [[0] * n for _ in range(n)]

        for e1 in recent_events:
            if e1.asset in asset_map:
                idx1 = asset_map[e1.asset]
                jump_counts[idx1] += 1
                for e2 in recent_events:
                    if e2.asset in asset_map and e1.asset != e2.asset:
                        idx2 = asset_map[e2.asset]
                        if abs(e1.timestamp_sec - e2.timestamp_sec) <= self.sync_window_sec:
                            pair_cojumps[idx1][idx2] += 1

        # Build Gamma_ij: expected direct offspring in asset i from shock in asset j
        matrix = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                if i == j:
                    # Self-excitation
                    alpha = alpha_self_base * (1.0 + min(3.0, 0.2 * jump_counts[i]))
                    matrix[i][j] = alpha / self.baseline_decay_beta
                else:
                    # Mutual cross-excitation
                    cojump_boost = min(4.0, 0.4 * pair_cojumps[i][j])
                    alpha = alpha_cross_base * (1.0 + cojump_boost)
                    matrix[i][j] = alpha / self.baseline_decay_beta

        spec_radius, eigenvector = self.calculate_spectral_radius(matrix)
        is_supercritical = spec_radius >= self.supercritical_threshold

        # Find dominant contagion node
        max_idx = 0
        if eigenvector:
            max_idx = max(range(n), key=lambda k: eigenvector[k])
        dominant_node = assets[max_idx] if assets else ""

        return BranchingMatrixAnalysis(
            assets=assets,
            branching_matrix=matrix,
            spectral_radius=round(spec_radius, 4),
            is_supercritical=is_supercritical,
            dominant_contagion_node=dominant_node,
        )

    def assess_contagion(
        self,
        assets: List[str],
        current_time_sec: float,
        recent_events: List[LiquidityEvent],
        alpha_self_base: float = 0.25,
        alpha_cross_base: float = 0.15,
    ) -> CoJumpContagionAssessment:
        """
        Synthesizes active co-jumps and branching matrix dynamics into real-time
        circuit-breaker directives.
        """
        rationales: List[str] = []

        # Filter events in sync window
        sync_events = [
            e for e in recent_events
            if (current_time_sec - e.timestamp_sec) <= self.sync_window_sec
            and self.is_liquidity_jump(e.spread_zscore, e.depth_drop_pct)
        ]

        shocked_assets = list(set(e.asset for e in sync_events))
        active_cojumps_count = len(shocked_assets)

        # Build Hawkes branching analysis
        analysis = self.build_branching_matrix(
            assets=assets,
            recent_events=recent_events,
            current_time_sec=current_time_sec,
            alpha_self_base=alpha_self_base,
            alpha_cross_base=alpha_cross_base,
        )

        rho = analysis.spectral_radius

        # Systemic risk score formulation
        score = 0.5 * min(1.0, rho / 1.0) + 0.5 * min(1.0, active_cojumps_count / max(1, len(assets)))
        systemic_risk_score = round(min(1.0, max(0.0, score)), 3)

        # State and Directive Decision Logic:
        # 1. Supercritical explosive cascade or synchronized collapse across >= 3 assets
        if rho >= self.supercritical_threshold or active_cojumps_count >= max(3, len(assets) * 0.6):
            regime = CoJumpRegimeState.SUPERCRITICAL_FLASH_CRASH_RUN
            directive = LiquidityCircuitDirective.EMERGENCY_GLOBAL_CIRCUIT_PULL
            rationales.append(f"Supercritical branching ratio detected (rho={rho:.3f} >= {self.supercritical_threshold:.2f}) with {active_cojumps_count} synchronized asset co-jumps. Immediate global quote pull mandated.")

        # 2. Systemic co-jump clustering
        elif rho >= 0.65 or active_cojumps_count >= 2:
            regime = CoJumpRegimeState.SYSTEMIC_COJUMP_CLUSTER
            directive = LiquidityCircuitDirective.THROTTLE_CROSS_CORRELATION_RISK
            rationales.append(f"Systemic cross-asset excitation elevated (rho={rho:.3f}, {active_cojumps_count} co-jumping assets). Dominant contagion anchor: {analysis.dominant_contagion_node}. Throttle inventory risk.")

        # 3. Localized idiosyncratic shock
        elif active_cojumps_count == 1:
            regime = CoJumpRegimeState.LOCALIZED_CONTAINED_SHOCK
            directive = LiquidityCircuitDirective.WIDEN_LOCAL_SPREADS
            rationales.append(f"Isolated liquidity dislocation in {shocked_assets[0]} (subcritical rho={rho:.3f}). Widen quotes locally; maintain general provisioning.")

        # 4. Tranquil
        else:
            regime = CoJumpRegimeState.TRANQUIL_STABLE
            directive = LiquidityCircuitDirective.MAINTAIN_NORMAL_QUOTING
            rationales.append(f"Order books calm across all {len(assets)} assets. Subcritical branching (rho={rho:.3f}). Quoting parameters optimal.")

        return CoJumpContagionAssessment(
            timestamp_sec=current_time_sec,
            active_cojumps_count=active_cojumps_count,
            spectral_radius=rho,
            regime=regime,
            directive=directive,
            shocked_assets=shocked_assets,
            systemic_risk_score=systemic_risk_score,
            rationales=rationales,
        )
