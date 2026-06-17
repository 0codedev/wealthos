"""
Domain 274 / WP-FT: High-Frequency Limit Order Book Hawkes Self-Excitation Branching Sentry
=============================================================================================
Institutional quantitative sentry estimating the Hawkes point process branching ratio eta = alpha / beta,
monitoring criticality phase transitions, and sniping post-cascade liquidity exhaustion reversals.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import math
import numpy as np


class HawkesCriticalityRegime(str, Enum):
    SUBCRITICAL_STABLE_EQUILIBRIUM = "SUBCRITICAL_STABLE_EQUILIBRIUM"
    CRITICAL_ELEVATED_CLUSTERING = "CRITICAL_ELEVATED_CLUSTERING"
    SUPERCRITICAL_CASCADE_EVACUATION = "SUPERCRITICAL_CASCADE_EVACUATION"
    CASCADE_EXHAUSTION_MEAN_REVERSION_SNIPER = "CASCADE_EXHAUSTION_MEAN_REVERSION_SNIPER"


class HawkesOrderDirective(str, Enum):
    MAINTAIN_STANDARD_MAKER_QUOTES = "MAINTAIN_STANDARD_MAKER_QUOTES"
    WIDEN_QUOTES_HALVE_SIZE = "WIDEN_QUOTES_HALVE_SIZE"
    EMERGENCY_EVACUATE_ALL_RESTING_QUOTES = "EMERGENCY_EVACUATE_ALL_RESTING_QUOTES"
    EXECUTE_EXHAUSTION_LIQUIDITY_SNIPE = "EXECUTE_EXHAUSTION_LIQUIDITY_SNIPE"


@dataclass
class HawkesAssessment:
    symbol: str
    current_time_sec: float
    baseline_intensity_mu: float
    instantaneous_intensity_lambda: float
    peak_recent_intensity: float
    branching_ratio_eta: float
    intensity_ratio_to_mu: float
    exhaustion_decay_pct: float
    regime: HawkesCriticalityRegime
    directive: HawkesOrderDirective
    rationales: List[str] = field(default_factory=list)


class LOBHawkesBranchingSentry:
    """
    Evaluates self-exciting order flow point process intensity:
    lambda(t) = mu_0 + sum_{t_i < t} alpha * exp(-beta * (t - t_i)).
    Computes branching ratio eta = alpha / beta to detect explosive cascades and exhaustion points.
    """

    def __init__(
        self,
        baseline_intensity_mu: float = 2.0,    # 2 trades/sec baseline
        alpha_jump: float = 1.2,               # Excitation per event
        beta_decay: float = 1.5,               # Memory relaxation rate (1/sec)
        critical_branching_hurdle: float = 0.80, # eta >= 0.80 indicates near-critical clustering
        supercritical_hurdle: float = 1.0,     # eta >= 1.0 is explosive supercritical cascade
    ):
        self.mu = baseline_intensity_mu
        self.alpha = alpha_jump
        self.beta = beta_decay
        self.crit_hurdle = critical_branching_hurdle
        self.supercrit_hurdle = supercritical_hurdle
        self.peak_intensity = baseline_intensity_mu

    def calculate_intensity(
        self,
        t_now: float,
        event_timestamps: List[float],
    ) -> float:
        """
        Recursive Hawkes intensity evaluation:
        lambda(t) = mu + sum_{t_i < t} alpha * exp(-beta * (t - t_i))
        """
        if not event_timestamps:
            return self.mu

        total_excitation = 0.0
        for ti in event_timestamps:
            dt = t_now - ti
            if dt >= 0.0:
                total_excitation += self.alpha * math.exp(-self.beta * dt)

        return self.mu + total_excitation

    def evaluate_lob_flow(
        self,
        symbol: str,
        current_time_sec: float,
        recent_trade_timestamps: List[float],
        custom_alpha: Optional[float] = None,
        custom_beta: Optional[float] = None,
    ) -> HawkesAssessment:
        rationales = []
        alpha = custom_alpha if custom_alpha is not None else self.alpha
        beta = custom_beta if custom_beta is not None else self.beta

        # Branching ratio eta = alpha / beta
        eta = alpha / max(1e-4, beta)

        # Intensity calculation
        current_intensity = self.calculate_intensity(current_time_sec, recent_trade_timestamps)

        # Peak intensity tracking
        if current_intensity > self.peak_intensity:
            self.peak_intensity = current_intensity

        intensity_ratio = current_intensity / max(1e-4, self.mu)

        # Exhaustion decay from peak
        if self.peak_intensity > (self.mu * 3.0):
            exhaustion_decay = ((self.peak_intensity - current_intensity) / max(1e-4, self.peak_intensity)) * 100.0
        else:
            exhaustion_decay = 0.0

        # Decision State Machine
        if (eta >= self.supercrit_hurdle or intensity_ratio >= 5.0) and exhaustion_decay < 50.0:
            regime = HawkesCriticalityRegime.SUPERCRITICAL_CASCADE_EVACUATION
            directive = HawkesOrderDirective.EMERGENCY_EVACUATE_ALL_RESTING_QUOTES
            rationales.append(
                f"Supercritical self-exciting cascade on {symbol}: Branching ratio eta={eta:.2f} "
                f"(Hurdle={self.supercrit_hurdle:.2f}), Intensity={current_intensity:.1f} trades/s "
                f"({intensity_ratio:.1f}x baseline). Avalanche in progress. Pull all resting maker quotes!"
            )
        elif self.peak_intensity >= (self.mu * 4.0) and exhaustion_decay >= 55.0:
            regime = HawkesCriticalityRegime.CASCADE_EXHAUSTION_MEAN_REVERSION_SNIPER
            directive = HawkesOrderDirective.EXECUTE_EXHAUSTION_LIQUIDITY_SNIPE
            rationales.append(
                f"Hawkes cascade exhaustion verified on {symbol}: Peak={self.peak_intensity:.1f} trades/s "
                f"collapsed by {exhaustion_decay:.1f}% to {current_intensity:.1f} trades/s. "
                f"Order book queue panic has exhausted while spreads remain wide. Deploy exhaustion sniper."
            )
            # Reset peak tracker after exhaustion is sniped
            self.peak_intensity = current_intensity
        elif eta >= self.crit_hurdle or intensity_ratio >= 2.5:
            regime = HawkesCriticalityRegime.CRITICAL_ELEVATED_CLUSTERING
            directive = HawkesOrderDirective.WIDEN_QUOTES_HALVE_SIZE
            rationales.append(
                f"Near-critical order clustering on {symbol}: Branching ratio eta={eta:.2f}, "
                f"Intensity={current_intensity:.1f} trades/s ({intensity_ratio:.1f}x baseline). "
                f"Elevated adverse selection; widen quotes and reduce maker sizes by 50%."
            )
        else:
            regime = HawkesCriticalityRegime.SUBCRITICAL_STABLE_EQUILIBRIUM
            directive = HawkesOrderDirective.MAINTAIN_STANDARD_MAKER_QUOTES
            rationales.append(
                f"Subcritical stable order flow on {symbol}: Branching ratio eta={eta:.2f}, "
                f"Intensity={current_intensity:.1f} trades/s. Quiescent market; maintain standard quotes."
            )

        return HawkesAssessment(
            symbol=symbol,
            current_time_sec=round(current_time_sec, 3),
            baseline_intensity_mu=round(self.mu, 2),
            instantaneous_intensity_lambda=round(current_intensity, 2),
            peak_recent_intensity=round(self.peak_intensity, 2),
            branching_ratio_eta=round(eta, 3),
            intensity_ratio_to_mu=round(intensity_ratio, 2),
            exhaustion_decay_pct=round(exhaustion_decay, 1),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
