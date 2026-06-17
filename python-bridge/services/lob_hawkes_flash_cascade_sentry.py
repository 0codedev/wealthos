r"""High-Frequency Limit Order Book Hawkes Self-Excitation & Flash Cascade Sentry (Domain 220 / WP-DR)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Multi-variate marked Hawkes (1971) self- and cross-exciting order arrival intensity model.
2. Exact branching matrix \mathbf{\Gamma}_{ij} = \alpha_{ij} / \beta_{ij} and spectral radius \rho(\mathbf{\Gamma}) calculus.
3. Supercritical cascade phase transition detector (\rho(\mathbf{\Gamma}) >= 0.85) predicting flash crashes.
4. Microsecond liquidity provider circuit breaker and emergency quote pull sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class HawkesCascadeRegime(Enum):
    """Reflexive market regime based on Hawkes branching spectral radius."""
    SUBCRITICAL_STABLE = "SUBCRITICAL_STABLE"           # rho < 0.60, stationary exogenous noise
    ELEVATED_CLUSTERING = "ELEVATED_CLUSTERING"         # 0.60 <= rho < 0.85, endogenous clustering
    SUPERCRITICAL_CASCADE = "SUPERCRITICAL_CASCADE"     # rho >= 0.85, runaway self-exciting chain reaction


class HawkesTacticalAction(Enum):
    """Recommended liquidity defense posture."""
    MAINTAIN_NORMAL_SPREAD = "MAINTAIN_NORMAL_SPREAD"
    WIDEN_MAKER_SPREAD = "WIDEN_MAKER_SPREAD"           # Widen quotes by 1.5x - 2.0x
    EMERGENCY_CANCEL_ALL = "EMERGENCY_CANCEL_ALL"       # Pull all resting orders to avoid toxic cascade


@dataclass
class HawkesKernelParams:
    """Calibrated parameters for bivariate buy/sell Hawkes process."""
    mu_buy: float                      # Baseline exogenous buy intensity (trades/sec)
    mu_sell: float                     # Baseline exogenous sell intensity (trades/sec)
    alpha_buy_buy: float               # Buy self-excitation
    alpha_buy_sell: float              # Cross-excitation (sell triggering buy)
    alpha_sell_buy: float              # Cross-excitation (buy triggering sell)
    alpha_sell_sell: float             # Sell self-excitation
    beta_decay: float                  # Memory decay rate (1/sec)


@dataclass
class HawkesDiagnosticsResult:
    """Full quantitative diagnostics for Hawkes branching stability."""
    symbol: str
    instantaneous_buy_intensity: float
    instantaneous_sell_intensity: float
    branching_matrix: List[List[float]] # 2x2 Gamma matrix
    spectral_radius: float             # rho(Gamma)
    cascade_regime: HawkesCascadeRegime
    recommended_action: HawkesTacticalAction
    quote_spread_multiplier: float
    tactical_directive: str


class LOBHawkesFlashCascadeSentry:
    r"""Bivariate Hawkes Self-Exciting Point Process & Cascade Sentry.
    
    Mathematical Formulation:
    1. Bivariate Arrival Intensities:
       \lambda_b(t) = \mu_b + \sum_{t_k^b < t} \alpha_{bb} e^{-\beta(t - t_k^b)} + \sum_{t_k^s < t} \alpha_{bs} e^{-\beta(t - t_k^s)}
       \lambda_s(t) = \mu_s + \sum_{t_k^b < t} \alpha_{sb} e^{-\beta(t - t_k^b)} + \sum_{t_k^s < t} \alpha_{ss} e^{-\beta(t - t_k^s)}
       
    2. Branching Matrix:
       \mathbf{\Gamma} = \begin{pmatrix} \Gamma_{bb} & \Gamma_{bs} \\ \Gamma_{sb} & \Gamma_{ss} \end{pmatrix} = \begin{pmatrix} \alpha_{bb}/\beta & \alpha_{bs}/\beta \\ \alpha_{sb}/\beta & \alpha_{ss}/\beta \end{pmatrix}
       
    3. Spectral Radius:
       \rho(\mathbf{\Gamma}) = \frac{\text{Tr} + \sqrt{\max(0, \text{Tr}^2 - 4\text{Det})}}{2}
       where \text{Tr} = \Gamma_{bb} + \Gamma_{ss}, \quad \text{Det} = \Gamma_{bb}\Gamma_{ss} - \Gamma_{bs}\Gamma_{sb}
       
    4. Stationarity Condition:
       \rho(\mathbf{\Gamma}) < 1.0 \quad (\text{Subcritical}). \quad \rho(\mathbf{\Gamma}) \ge 0.85 \implies \text{Emergency Trigger}.
    """

    def __init__(
        self,
        critical_spectral_radius: float = 0.85,
        elevated_spectral_radius: float = 0.60,
    ) -> None:
        self.crit_rho = critical_spectral_radius
        self.elev_rho = elevated_spectral_radius

    def compute_branching_spectral_radius(
        self,
        params: HawkesKernelParams,
    ) -> Tuple[List[List[float]], float]:
        """Compute the 2x2 branching matrix Gamma and its principal spectral radius rho."""
        beta = max(params.beta_decay, 1e-4)

        g_bb = params.alpha_buy_buy / beta
        g_bs = params.alpha_buy_sell / beta
        g_sb = params.alpha_sell_buy / beta
        g_ss = params.alpha_sell_sell / beta

        gamma = [
            [round(g_bb, 4), round(g_bs, 4)],
            [round(g_sb, 4), round(g_ss, 4)],
        ]

        tr = g_bb + g_ss
        det = g_bb * g_ss - g_bs * g_sb
        disc = max(0.0, tr * tr - 4.0 * det)
        rho = (tr + math.sqrt(disc)) / 2.0

        return gamma, round(rho, 4)

    def evaluate_hawkes_sentry(
        self,
        symbol: str,
        params: HawkesKernelParams,
        buy_timestamps: List[float],
        sell_timestamps: List[float],
        current_time_sec: float,
    ) -> HawkesDiagnosticsResult:
        """Calculate real-time instantaneous intensities, spectral radius, and defensive posture."""
        gamma, rho = self.compute_branching_spectral_radius(params)
        beta = max(params.beta_decay, 1e-4)

        # Instantaneous Buy Intensity
        decay_sum_bb = sum(math.exp(-beta * (current_time_sec - t)) for t in buy_timestamps if t <= current_time_sec)
        decay_sum_bs = sum(math.exp(-beta * (current_time_sec - t)) for t in sell_timestamps if t <= current_time_sec)
        lambda_b = params.mu_buy + params.alpha_buy_buy * decay_sum_bb + params.alpha_buy_sell * decay_sum_bs

        # Instantaneous Sell Intensity
        decay_sum_sb = sum(math.exp(-beta * (current_time_sec - t)) for t in buy_timestamps if t <= current_time_sec)
        decay_sum_ss = sum(math.exp(-beta * (current_time_sec - t)) for t in sell_timestamps if t <= current_time_sec)
        lambda_s = params.mu_sell + params.alpha_sell_buy * decay_sum_sb + params.alpha_sell_sell * decay_sum_ss

        # Regime & Directives
        if rho >= self.crit_rho:
            regime = HawkesCascadeRegime.SUPERCRITICAL_CASCADE
            action = HawkesTacticalAction.EMERGENCY_CANCEL_ALL
            mult = 5.0
            directive = (
                f"SUPERCRITICAL FLASH CASCADE: Branching spectral radius rho = {rho:.3f} >= {self.crit_rho:.2f}! "
                f"Endogenous reflexive trades self-exciting. Pull all quotes immediately to evade cascade wipeout!"
            )
        elif rho >= self.elev_rho:
            regime = HawkesCascadeRegime.ELEVATED_CLUSTERING
            action = HawkesTacticalAction.WIDEN_MAKER_SPREAD
            mult = 1.75
            directive = (
                f"ELEVATED CLUSTERING: Spectral radius rho = {rho:.3f} in warning zone [{self.elev_rho:.2f}, {self.crit_rho:.2f}). "
                f"Widen maker spread by {mult:.2f}x to buffer against trade clustering."
            )
        else:
            regime = HawkesCascadeRegime.SUBCRITICAL_STABLE
            action = HawkesTacticalAction.MAINTAIN_NORMAL_SPREAD
            mult = 1.0
            directive = (
                f"SUBCRITICAL STABLE: Spectral radius rho = {rho:.3f} < {self.elev_rho:.2f}. "
                f"Intensities: Buy={lambda_b:.1f}/s, Sell={lambda_s:.1f}/s. Maintain standard quoting spread."
            )

        return HawkesDiagnosticsResult(
            symbol=symbol,
            instantaneous_buy_intensity=round(lambda_b, 2),
            instantaneous_sell_intensity=round(lambda_s, 2),
            branching_matrix=gamma,
            spectral_radius=rho,
            cascade_regime=regime,
            recommended_action=action,
            quote_spread_multiplier=mult,
            tactical_directive=directive,
        )
