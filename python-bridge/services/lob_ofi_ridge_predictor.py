"""
High-Frequency Limit Order Book Order Flow Imbalance (OFI) Multi-Level Ridge Predictor
Domain 277 / Work Package WP-FW

Constructs multi-level Order Flow Imbalance (OFI) vectors across LOB depths (Cont, Kukanov & Stoikov 2014;
Xu et al. 2021) and calibrates L2-regularized Ridge regression to forecast instantaneous mid-price jumps.
Detects toxic adverse selection sweeps in real time and directs asymmetric maker quote adjustments or evasions.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class OFIFlowRegime(str, Enum):
    BALANCED_EQUILIBRIUM = "BALANCED_EQUILIBRIUM"              # |Z_OFI| < 1.0, two-sided liquidity making
    MODERATE_DIRECTIONAL_SKEW = "MODERATE_DIRECTIONAL_SKEW"    # 1.0 <= |Z_OFI| < 2.5, lean quotes with flow
    TOXIC_BUY_ASSAULT = "TOXIC_BUY_ASSAULT"                    # Z_OFI >= 2.5, aggressive sweep eating ask queue
    TOXIC_SELL_CASCADE = "TOXIC_SELL_CASCADE"                  # Z_OFI <= -2.5, aggressive dump eating bid queue


class OFIExecutionDirective(str, Enum):
    SYMMETRIC_MARKET_MAKING = "SYMMETRIC_MARKET_MAKING"        # Standard tight two-sided maker quoting
    SKEW_SPREAD_ASYMMETRIC = "SKEW_SPREAD_ASYMMETRIC"          # Widen spread against adverse flow, skew inventory
    PULL_ASKS_SNIPE_BUY = "PULL_ASKS_SNIPE_BUY"                # Preemptively cancel asks to avoid fill; ride momentum
    PULL_BIDS_SNIPE_SELL = "PULL_BIDS_SNIPE_SELL"              # Preemptively cancel bids to avoid fill; ride dump


@dataclass
class BookLevel:
    level: int          # 1 for best bid/ask, 2 for next level, etc.
    bid_price: float
    bid_size: float
    ask_price: float
    ask_size: float


@dataclass
class LOBLevelState:
    levels: List[BookLevel]  # Levels 1 to K ordered by proximity to mid
    timestamp_ns: int = 0


@dataclass
class RidgeCalibrationConfig:
    num_levels: int = 5              # Depth levels K (default 5)
    ridge_lambda: float = 1e-3       # L2 penalty parameter lambda
    adverse_z_threshold: float = 2.5 # Z-score boundary for toxic flow
    decay_horizon: float = 0.5       # Half-life / weight attenuation factor


@dataclass
class OFIPredictionAssessment:
    asset_id: str
    ofi_vector: List[float]          # Level-by-level OFI [OFI_1, ..., OFI_K]
    predicted_mid_delta: float       # Expected mid-price jump \hat{\Delta P}
    z_score: float                   # Standardized OFI prediction Z-score
    regime: OFIFlowRegime
    directive: OFIExecutionDirective
    recommended_spread_skew_bps: float
    ridge_coefficients: List[float]  # Calibrated beta_k weights
    rationales: List[str] = field(default_factory=list)


class LOBMultiLevelOFIRidgePredictor:
    """
    Computes multi-level order flow imbalance vectors and predicts short-horizon price changes
    via regularized ridge regression.
    """

    def __init__(self, config: Optional[RidgeCalibrationConfig] = None):
        self.config = config or RidgeCalibrationConfig()
        # Default prior coefficients decreasing with depth (Level 1 impact highest)
        self.default_betas = [
            0.60 * math.exp(-0.45 * k) for k in range(self.config.num_levels)
        ]

    def compute_level_ofi(
        self,
        prev_level: BookLevel,
        curr_level: BookLevel,
    ) -> float:
        """
        Calculates Cont-Kukanov-Stoikov OFI for a specific order book depth level:
        OFI_k = e_{b,k} - e_{a,k}
        """
        # Bid component e_b (positive = buyer demand pushing prices up)
        if curr_level.bid_price > prev_level.bid_price:
            e_b = curr_level.bid_size
        elif curr_level.bid_price == prev_level.bid_price:
            e_b = curr_level.bid_size - prev_level.bid_size
        else:
            e_b = -prev_level.bid_size

        # Ask component e_a (positive = seller supply pushing prices down)
        if curr_level.ask_price < prev_level.ask_price:
            e_a = curr_level.ask_size
        elif curr_level.ask_price == prev_level.ask_price:
            e_a = curr_level.ask_size - prev_level.ask_size
        else:
            e_a = -prev_level.ask_size

        return e_b - e_a

    def compute_ofi_vector(
        self,
        prev_book: LOBLevelState,
        curr_book: LOBLevelState,
    ) -> List[float]:
        """
        Extracts OFI vector across all available levels up to num_levels.
        """
        k = min(self.config.num_levels, len(prev_book.levels), len(curr_book.levels))
        ofi_vec = []
        for i in range(k):
            ofi_vec.append(self.compute_level_ofi(prev_book.levels[i], curr_book.levels[i]))
        # Pad with 0.0 if fewer levels provided
        while len(ofi_vec) < self.config.num_levels:
            ofi_vec.append(0.0)
        return ofi_vec

    def fit_ridge_coefficients(
        self,
        X: List[List[float]],
        y: List[float],
    ) -> List[float]:
        r"""
        Fits ridge regression coefficients \hat{\beta} = (X^T X + \lambda I)^{-1} X^T y.
        Uses Gauss-Jordan elimination on regularized normal equations for pure Python determinism.
        """
        N = len(X)
        K = self.config.num_levels
        if N < K:
            return list(self.default_betas)

        # Compute X^T X (K x K) and X^T y (K x 1)
        XtX = [[0.0] * K for _ in range(K)]
        Xty = [0.0] * K

        for row_idx in range(N):
            row = X[row_idx]
            target = y[row_idx]
            for i in range(K):
                Xty[i] += row[i] * target
                for j in range(K):
                    XtX[i][j] += row[i] * row[j]

        # Add Ridge penalty \lambda * I
        for i in range(K):
            XtX[i][i] += self.config.ridge_lambda * N

        # Augmented matrix [XtX | Xty]
        aug = [XtX[i] + [Xty[i]] for i in range(K)]

        # Gauss-Jordan elimination
        for i in range(K):
            # Pivot selection
            max_row = i
            max_val = abs(aug[i][i])
            for r in range(i + 1, K):
                if abs(aug[r][i]) > max_val:
                    max_val = abs(aug[r][i])
                    max_row = r
            if max_row != i:
                aug[i], aug[max_row] = aug[max_row], aug[i]

            pivot = aug[i][i]
            if abs(pivot) < 1e-12:
                pivot = 1e-12 if pivot >= 0 else -1e-12

            for c in range(i, K + 1):
                aug[i][c] /= pivot

            for r in range(K):
                if r != i:
                    factor = aug[r][i]
                    for c in range(i, K + 1):
                        aug[r][c] -= factor * aug[i][c]

        betas = [aug[i][K] for i in range(K)]
        return betas

    def evaluate_order_flow(
        self,
        asset_id: str,
        prev_book: LOBLevelState,
        curr_book: LOBLevelState,
        historical_ofi_history: Optional[List[List[float]]] = None,
        historical_delta_history: Optional[List[float]] = None,
        custom_betas: Optional[List[float]] = None,
        baseline_pred_std: float = 0.50,
    ) -> OFIPredictionAssessment:
        """
        Evaluates multi-level OFI vector, computes predicted mid delta and risk directives.
        """
        ofi_vec = self.compute_ofi_vector(prev_book, curr_book)

        # Calibrate or assign ridge coefficients
        if custom_betas is not None and len(custom_betas) == self.config.num_levels:
            betas = list(custom_betas)
        elif historical_ofi_history is not None and historical_delta_history is not None:
            betas = self.fit_ridge_coefficients(historical_ofi_history, historical_delta_history)
        else:
            betas = list(self.default_betas)

        # Predict mid price jump \hat{\Delta P} = \sum_k \beta_k OFI_k
        pred_mid_delta = sum(betas[i] * ofi_vec[i] for i in range(self.config.num_levels))

        # Standardize Z-score
        std_safe = max(1e-6, baseline_pred_std)
        z_score = pred_mid_delta / std_safe

        rationales: List[str] = []
        if z_score >= self.config.adverse_z_threshold:
            regime = OFIFlowRegime.TOXIC_BUY_ASSAULT
            directive = OFIExecutionDirective.PULL_ASKS_SNIPE_BUY
            spread_skew_bps = 5.0  # Widen ask or pull quotes completely
            rationales.append(
                f"Severe toxic buy order flow imbalance detected (Z = +{z_score:.2f} >= +{self.config.adverse_z_threshold}). "
                f"Evacuate maker ask quotes to avert adverse selection pickoff; skew upward."
            )
        elif z_score <= -self.config.adverse_z_threshold:
            regime = OFIFlowRegime.TOXIC_SELL_CASCADE
            directive = OFIExecutionDirective.PULL_BIDS_SNIPE_SELL
            spread_skew_bps = -5.0 # Widen bid or pull quotes completely
            rationales.append(
                f"Severe toxic sell order flow imbalance detected (Z = {z_score:.2f} <= -{self.config.adverse_z_threshold}). "
                f"Evacuate maker bid quotes to avert adverse selection pickoff; skew downward."
            )
        elif abs(z_score) >= 1.0:
            regime = OFIFlowRegime.MODERATE_DIRECTIONAL_SKEW
            directive = OFIExecutionDirective.SKEW_SPREAD_ASYMMETRIC
            spread_skew_bps = 1.5 * (1.0 if z_score > 0 else -1.0)
            rationales.append(
                f"Moderate directional order flow (Z = {z_score:.2f}). "
                f"Asymmetrically lean spread quotes by {spread_skew_bps:+.1f} bps."
            )
        else:
            regime = OFIFlowRegime.BALANCED_EQUILIBRIUM
            directive = OFIExecutionDirective.SYMMETRIC_MARKET_MAKING
            spread_skew_bps = 0.0
            rationales.append("Order flow imbalance in balanced equilibrium; normal symmetric quoting maintained.")

        return OFIPredictionAssessment(
            asset_id=asset_id,
            ofi_vector=ofi_vec,
            predicted_mid_delta=pred_mid_delta,
            z_score=z_score,
            regime=regime,
            directive=directive,
            recommended_spread_skew_bps=spread_skew_bps,
            ridge_coefficients=betas,
            rationales=rationales,
        )
