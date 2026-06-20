"""
Domain 271 / WP-FQ: Multi-Exchange Continuous Statistical Arbitrage Pairs Kalman Filter Hedge Ratio Kernel
========================================================================================================
Institutional quantitative state-space engine estimating continuous dynamic hedge ratios beta_t
and recursive observation residuals to execute adaptive statistical arbitrage pairs trading.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple
import numpy as np


class PairsStatArbRegime(str, Enum):
    EQUILIBRIUM_HOLD_OR_UNWIND = "EQUILIBRIUM_HOLD_OR_UNWIND"
    SPREAD_LONG_DISLOCATION_ENTRY = "SPREAD_LONG_DISLOCATION_ENTRY"
    SPREAD_SHORT_DISLOCATION_ENTRY = "SPREAD_SHORT_DISLOCATION_ENTRY"
    STRUCTURAL_BREAKDOWN_ABORT = "STRUCTURAL_BREAKDOWN_ABORT"


class PairsStatArbDirective(str, Enum):
    MAINTAIN_NEUTRAL_POSITION = "MAINTAIN_NEUTRAL_POSITION"
    LONG_ASSET_Y_SHORT_BETA_X = "LONG_ASSET_Y_SHORT_BETA_X"
    SHORT_ASSET_Y_LONG_BETA_X = "SHORT_ASSET_Y_LONG_BETA_X"
    EMERGENCY_UNWIND_DECOUPLED_PAIR = "EMERGENCY_UNWIND_DECOUPLED_PAIR"


@dataclass
class KalmanStateSnapshot:
    alpha: float
    beta: float
    spread: float
    innovation_variance: float
    z_score: float


@dataclass
class PairsAssessment:
    asset_y: str
    asset_x: str
    price_y: float
    price_x: float
    estimated_alpha: float
    estimated_beta: float
    current_spread: float
    spread_z_score: float
    recommended_x_hedge_ratio: float
    regime: PairsStatArbRegime
    directive: PairsStatArbDirective
    rationales: List[str] = field(default_factory=list)


class PairsKalmanFilterKernel:
    """
    Online recursive Kalman Filter estimating state-space parameters theta = [alpha, beta]^T
    for cointegrated statistical arbitrage pairs.
    """

    def __init__(
        self,
        delta_transition_noise: float = 1e-4,  # Process noise variance parameter Q
        measurement_noise: float = 0.05,       # Observation noise variance R
        entry_z_hurdle: float = 2.0,           # 2.0 sigma entry threshold
        exit_z_hurdle: float = 0.5,            # 0.5 sigma take profit threshold
        abort_z_hurdle: float = 4.5,           # 4.5 sigma structural breakdown circuit
    ):
        self.delta_trans = delta_transition_noise
        self.R = measurement_noise
        self.entry_z = entry_z_hurdle
        self.exit_z = exit_z_hurdle
        self.abort_z = abort_z_hurdle

        # State vector: [alpha, beta]^T
        self.theta = np.zeros(2)
        # Covariance matrix P
        self.P = np.eye(2) * 1.0

    def update_tick(self, x: float, y: float) -> KalmanStateSnapshot:
        """
        Processes a new observation (x_t, y_t) and updates the Kalman state.
        """
        # Process noise covariance Q: beta drifts over time
        Q = np.eye(2) * self.delta_trans

        # 1. Predict
        theta_pred = self.theta
        P_pred = self.P + Q

        # 2. Observation matrix H_t = [1.0, x]
        H = np.array([1.0, x])

        # 3. Innovation (Measurement Residual)
        y_pred = float(np.dot(H, theta_pred))
        e = float(y - y_pred)

        # Innovation Variance S_t = H * P_pred * H^T + R
        S = float(np.dot(H, np.dot(P_pred, H)) + self.R)
        std_e = max(1e-6, np.sqrt(S))
        z_score = e / std_e

        # 4. Kalman Gain K_t = P_pred * H^T / S
        K = np.dot(P_pred, H) / S

        # 5. Update State & Covariance
        self.theta = theta_pred + K * e
        self.P = P_pred - np.outer(K, np.dot(H, P_pred))

        return KalmanStateSnapshot(
            alpha=float(self.theta[0]),
            beta=float(self.theta[1]),
            spread=e,
            innovation_variance=S,
            z_score=z_score,
        )

    def evaluate_pair(
        self,
        asset_y: str,
        asset_x: str,
        price_y: float,
        price_x: float,
    ) -> PairsAssessment:
        rationales = []
        snap = self.update_tick(price_x, price_y)

        alpha = snap.alpha
        beta = snap.beta
        z = snap.z_score
        spread = snap.spread

        # Decision State Machine
        if abs(z) >= self.abort_z:
            regime = PairsStatArbRegime.STRUCTURAL_BREAKDOWN_ABORT
            directive = PairsStatArbDirective.EMERGENCY_UNWIND_DECOUPLED_PAIR
            rationales.append(
                f"Catastrophic structural cointegration breakdown on {asset_y}-{asset_x}: "
                f"Z-Score={z:+.2f} exceeds abort hurdle of {self.abort_z:.1f} sigma. "
                f"Statistical relationship fractured. Emergency unwind all leg exposures immediately."
            )
        elif z <= -self.entry_z:
            regime = PairsStatArbRegime.SPREAD_LONG_DISLOCATION_ENTRY
            directive = PairsStatArbDirective.LONG_ASSET_Y_SHORT_BETA_X
            rationales.append(
                f"Pairs spread oversold dislocation on {asset_y}-{asset_x}: Spread={spread:+.4f}, "
                f"Z-Score={z:+.2f} <= -{self.entry_z:.1f}. Dynamic Beta={beta:.3f}. "
                f"Action: Long {asset_y}, Short {beta:.3f} units of {asset_x}."
            )
        elif z >= self.entry_z:
            regime = PairsStatArbRegime.SPREAD_SHORT_DISLOCATION_ENTRY
            directive = PairsStatArbDirective.SHORT_ASSET_Y_LONG_BETA_X
            rationales.append(
                f"Pairs spread overbought dislocation on {asset_y}-{asset_x}: Spread={spread:+.4f}, "
                f"Z-Score={z:+.2f} >= +{self.entry_z:.1f}. Dynamic Beta={beta:.3f}. "
                f"Action: Short {asset_y}, Long {beta:.3f} units of {asset_x}."
            )
        else:
            regime = PairsStatArbRegime.EQUILIBRIUM_HOLD_OR_UNWIND
            directive = PairsStatArbDirective.MAINTAIN_NEUTRAL_POSITION
            rationales.append(
                f"Pairs spread equilibrium on {asset_y}-{asset_x}: Spread={spread:+.4f}, "
                f"Z-Score={z:+.2f} within normal band (+/-{self.entry_z:.1f}). Beta={beta:.3f}."
            )

        return PairsAssessment(
            asset_y=asset_y,
            asset_x=asset_x,
            price_y=round(price_y, 4),
            price_x=round(price_x, 4),
            estimated_alpha=round(alpha, 4),
            estimated_beta=round(beta, 4),
            current_spread=round(spread, 4),
            spread_z_score=round(z, 2),
            recommended_x_hedge_ratio=round(beta, 4),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
