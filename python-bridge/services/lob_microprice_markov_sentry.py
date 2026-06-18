"""
Domain 266 / WP-FL: High-Frequency Limit Order Book Micro-Price Jump Markov Transition Sentry
=============================================================================================
High-frequency market microstructure sentry utilizing Stoikov's micro-price martingale
formulation, discretized order flow imbalance regimes, and Markov transition matrices
to predict sub-millisecond price jumps and prevent adverse maker execution.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Tuple, Optional
import numpy as np


class LOBJumpRegime(str, Enum):
    EQUILIBRIUM_STEADY_STATE = "EQUILIBRIUM_STEADY_STATE"
    UPWARD_MICRO_PRICE_JUMP_IMMINENT = "UPWARD_MICRO_PRICE_JUMP_IMMINENT"
    DOWNWARD_MICRO_PRICE_JUMP_IMMINENT = "DOWNWARD_MICRO_PRICE_JUMP_IMMINENT"
    ADVERSE_MAKER_HAZARD_ALERT = "ADVERSE_MAKER_HAZARD_ALERT"


class MicroPriceDirective(str, Enum):
    MAINTAIN_SYMMETRIC_QUOTES = "MAINTAIN_SYMMETRIC_QUOTES"
    PULL_RESTING_ASKS_BIAS_BID = "PULL_RESTING_ASKS_BIAS_BID"
    PULL_RESTING_BIDS_BIAS_ASK = "PULL_RESTING_BIDS_BIAS_ASK"
    EMERGENCY_EVACUATE_TOXIC_LEGS = "EMERGENCY_EVACUATE_TOXIC_LEGS"


@dataclass
class MicroPriceAssessment:
    symbol: str
    mid_price: float
    spread: float
    imbalance: float
    micro_price: float
    micro_price_delta_bps: float
    current_regime_index: int
    p_upward_jump: float
    p_downward_jump: float
    regime: LOBJumpRegime
    directive: MicroPriceDirective
    rationales: List[str] = field(default_factory=list)


class LOBMicroPriceMarkovSentry:
    """
    High-Frequency Limit Order Book Micro-Price Jump Markov Transition Sentry.
    Evaluates order book imbalance states and Markov transition probabilities to detect
    impending adverse selection ticks before resting quotes are picked off.
    """

    def __init__(
        self,
        imbalance_threshold: float = 0.60,
        jump_prob_hurdle: float = 0.65,
        hazard_delta_bps: float = 3.0,
    ):
        self.imbalance_threshold = imbalance_threshold
        self.jump_prob_hurdle = jump_prob_hurdle
        self.hazard_delta_bps = hazard_delta_bps

        # Default 5-state Markov Transition Matrix for imbalance regimes:
        # States: 0 (Severe Ask), 1 (Mod Ask), 2 (Neutral), 3 (Mod Bid), 4 (Severe Bid)
        # Persistent tri-diagonal structure calibrated from empirical L2 microstructure
        self.transition_matrix = np.array([
            [0.70, 0.22, 0.06, 0.01, 0.01],  # State 0
            [0.20, 0.55, 0.20, 0.04, 0.01],  # State 1
            [0.05, 0.25, 0.40, 0.25, 0.05],  # State 2
            [0.01, 0.04, 0.20, 0.55, 0.20],  # State 3
            [0.01, 0.01, 0.06, 0.22, 0.70],  # State 4
        ])

    def classify_imbalance_state(self, imbalance: float) -> int:
        """
        Classifies imbalance I in [-1, 1] into 5 discrete regimes:
        0: I < -0.60
        1: -0.60 <= I < -0.20
        2: -0.20 <= I <= 0.20
        3: 0.20 < I <= 0.60
        4: I > 0.60
        """
        if imbalance < -self.imbalance_threshold:
            return 0
        elif imbalance < -0.20:
            return 1
        elif imbalance <= 0.20:
            return 2
        elif imbalance <= self.imbalance_threshold:
            return 3
        else:
            return 4

    def update_transition_matrix(self, empirical_counts: np.ndarray) -> None:
        """
        Updates the internal transition matrix from empirical (5, 5) count observations.
        Applies Laplace add-1 smoothing to guarantee ergodicity.
        """
        smoothed = empirical_counts.astype(float) + 1.0
        row_sums = smoothed.sum(axis=1, keepdims=True)
        self.transition_matrix = smoothed / np.maximum(1e-9, row_sums)

    def evaluate_lob(
        self,
        symbol: str,
        best_bid: float,
        best_ask: float,
        bid_qty: float,
        ask_qty: float,
    ) -> MicroPriceAssessment:
        rationales = []
        mid = (best_bid + best_ask) / 2.0
        spread = max(1e-6, best_ask - best_bid)

        # Micro-price imbalance
        tot_qty = max(1e-6, bid_qty + ask_qty)
        imbalance = (bid_qty - ask_qty) / tot_qty
        imbalance = max(-1.0, min(1.0, imbalance))

        # Stoikov micro-price formulation: P_micro = P_mid + I * (Spread / 2)
        # Higher-order nonlinear adjustment: g(I) = sign(I) * |I|^0.85
        g_imbalance = np.sign(imbalance) * (abs(imbalance) ** 0.85)
        micro_price = mid + g_imbalance * (spread / 2.0)
        micro_delta_bps = ((micro_price - mid) / mid) * 10000.0

        # State classification & Markov transition probabilities
        state = self.classify_imbalance_state(imbalance)
        state_probs = self.transition_matrix[state]

        # Probability of upward tick (states 3 and 4) vs downward tick (states 0 and 1)
        p_upward = float(state_probs[3] * 0.5 + state_probs[4] * 1.0)
        p_downward = float(state_probs[1] * 0.5 + state_probs[0] * 1.0)

        # Decision State Machine
        if state == 4 and (p_upward >= self.jump_prob_hurdle or micro_delta_bps >= self.hazard_delta_bps):
            regime = LOBJumpRegime.UPWARD_MICRO_PRICE_JUMP_IMMINENT
            directive = MicroPriceDirective.PULL_RESTING_ASKS_BIAS_BID
            rationales.append(
                f"Severe bid queue dominance on {symbol}: Imbalance={imbalance:+.2f}, "
                f"P(Upward Jump)={p_upward:.1%}, Micro-price delta={micro_delta_bps:+.1f} bps. "
                f"Resting asks face imminent adverse fill; pull asks and bias quote skew to bids."
            )
        elif state == 0 and (p_downward >= self.jump_prob_hurdle or micro_delta_bps <= -self.hazard_delta_bps):
            regime = LOBJumpRegime.DOWNWARD_MICRO_PRICE_JUMP_IMMINENT
            directive = MicroPriceDirective.PULL_RESTING_BIDS_BIAS_ASK
            rationales.append(
                f"Severe ask queue dominance on {symbol}: Imbalance={imbalance:+.2f}, "
                f"P(Downward Jump)={p_downward:.1%}, Micro-price delta={micro_delta_bps:+.1f} bps. "
                f"Resting bids face imminent adverse fill; pull bids and bias quote skew to asks."
            )
        elif abs(micro_delta_bps) >= (self.hazard_delta_bps * 1.5):
            regime = LOBJumpRegime.ADVERSE_MAKER_HAZARD_ALERT
            directive = MicroPriceDirective.EMERGENCY_EVACUATE_TOXIC_LEGS
            rationales.append(
                f"Adverse market maker hazard alert on {symbol}: Dislocation={abs(micro_delta_bps):.1f} bps "
                f"violates risk envelope. Evacuate resting quotes on vulnerable side immediately."
            )
        else:
            regime = LOBJumpRegime.EQUILIBRIUM_STEADY_STATE
            directive = MicroPriceDirective.MAINTAIN_SYMMETRIC_QUOTES
            rationales.append(
                f"Balanced queue equilibrium on {symbol}: Imbalance={imbalance:+.2f}, "
                f"Micro-delta={micro_delta_bps:+.1f} bps. Maintain standard two-sided market making."
            )

        return MicroPriceAssessment(
            symbol=symbol,
            mid_price=round(mid, 4),
            spread=round(spread, 4),
            imbalance=round(imbalance, 4),
            micro_price=round(micro_price, 4),
            micro_price_delta_bps=round(micro_delta_bps, 2),
            current_regime_index=state,
            p_upward_jump=round(p_upward, 4),
            p_downward_jump=round(p_downward, 4),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
