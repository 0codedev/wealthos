"""
Cross-Asset Implied Correlation Term-Structure & Volatility Index Basis Engine
Domain 244 / Work Package WP-EP

Extracts CBOE-style implied correlation term-structure surfaces from index and
constituent options smiles, computes the multi-tenor Correlation Risk Premium (CRP),
detects systemic crash correlation spikes, and optimizes volatility dispersion structures.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class CorrelationRegimeState(str, Enum):
    SYSTEMIC_CORRELATION_CRASH_PANIC = "SYSTEMIC_CORRELATION_CRASH_PANIC" # Inverted/hyper-elevated rho >= 0.80, crash deleveraging
    CORRELATION_DISPERSION_HARVEST = "CORRELATION_DISPERSION_HARVEST"     # Rich CRP >= 0.20, ideal dispersion harvesting
    IDIOSYNCRATIC_ALPHA_TRANQUIL = "IDIOSYNCRATIC_ALPHA_TRANQUIL"         # Low correlation <= 0.35, high stock selection alpha
    ARBITRAGE_CORRELATION_BOUNDARY = "ARBITRAGE_CORRELATION_BOUNDARY"     # Index IV violated theoretical sum-of-parts bounds


class CorrelationExecutionDirective(str, Enum):
    DEPLOY_SYSTEMIC_MACRO_COLLAR = "DEPLOY_SYSTEMIC_MACRO_COLLAR"         # Hard macro put protection, all diversification lost
    HARVEST_CORRELATION_DISPERSION = "HARVEST_CORRELATION_DISPERSION"     # Sell index volatility, buy single-stock basket vol
    ALLOCATE_IDIOSYNCRATIC_MOMENTUM = "ALLOCATE_IDIOSYNCRATIC_MOMENTUM"   # Maximize idiosyncratic alpha, unhedged factor books
    EXECUTE_INDEX_BASIS_ARBITRAGE = "EXECUTE_INDEX_BASIS_ARBITRAGE"       # Exploit boundary dislocation between index and parts


@dataclass
class TenorConstituentVols:
    tenor_years: float
    index_iv: float
    constituent_weights: List[float]
    constituent_ivs: List[float]
    realized_corr: float = 0.30


@dataclass
class ImpliedCorrelationTenorResult:
    tenor_years: float
    implied_corr: float
    realized_corr: float
    correlation_risk_premium: float      # implied_corr - realized_corr
    index_var: float
    weighted_single_var: float           # sum(w_i^2 * sigma_i^2)
    max_theoretical_var: float           # (sum(w_i * sigma_i))^2
    is_arbitrage_breach: bool


@dataclass
class CorrelationTermStructureAssessment:
    timestamp_sec: float
    tenor_results: List[ImpliedCorrelationTenorResult]
    term_slope: float                    # d(rho)/dt
    average_implied_corr: float
    average_crp: float
    regime: CorrelationRegimeState
    directive: CorrelationExecutionDirective
    dispersion_hedge_ratio: float        # 0.0 to 1.0
    rationales: List[str] = field(default_factory=list)


class ImpliedCorrelationTermStructureEngine:
    """
    Computes analytical implied equicorrelation surfaces across multiple option maturities,
    measuring the correlation risk premium and guarding portfolios against systemic co-movement.
    """

    def __init__(
        self,
        systemic_crash_threshold: float = 0.80,    # Implied correlation >= 80% marks systemic panic
        rich_crp_threshold: float = 0.18,          # CRP >= 18% signals profitable dispersion harvesting
        tranquil_corr_threshold: float = 0.38,     # Implied correlation <= 38% marks idiosyncratic calm
        inverted_slope_threshold: float = -0.35,   # Negative slope d(rho)/dt signaling short-term panic
    ):
        self.systemic_crash_threshold = systemic_crash_threshold
        self.rich_crp_threshold = rich_crp_threshold
        self.tranquil_corr_threshold = tranquil_corr_threshold
        self.inverted_slope_threshold = inverted_slope_threshold

    def compute_tenor_implied_correlation(
        self,
        tenor_data: TenorConstituentVols,
    ) -> ImpliedCorrelationTenorResult:
        """
        Solves analytical implied equicorrelation:
        rho_implied = (sigma_idx^2 - sum(w_i^2 * sigma_i^2)) / ((sum(w_i * sigma_i))^2 - sum(w_i^2 * sigma_i^2))
        """
        weights = tenor_data.constituent_weights
        ivs = tenor_data.constituent_ivs
        n = len(weights)
        if n != len(ivs) or n == 0:
            raise ValueError("Weights and IVs must have equal non-zero length.")

        # Normalize weights
        sum_w = sum(weights)
        norm_weights = [w / sum_w for w in weights] if sum_w > 0 else [1.0 / n] * n

        idx_var = tenor_data.index_iv ** 2
        weighted_single_var = sum((norm_weights[i] ** 2) * (ivs[i] ** 2) for i in range(n))
        weighted_sum_vol = sum(norm_weights[i] * ivs[i] for i in range(n))
        max_theoretical_var = weighted_sum_vol ** 2

        denominator = max_theoretical_var - weighted_single_var
        numerator = idx_var - weighted_single_var

        # Check boundary arbitrage
        is_breach = False
        if idx_var > max_theoretical_var + 1e-6:
            # Index IV exceeds maximum possible sum of parts (rho > 1.0)
            implied_corr = 1.0 + (idx_var - max_theoretical_var) / max(1e-4, denominator)
            is_breach = True
        elif idx_var < weighted_single_var - 1e-6:
            # Index IV less than zero-correlation baseline (rho < 0.0)
            implied_corr = -1.0 * (weighted_single_var - idx_var) / max(1e-4, denominator)
            is_breach = True
        else:
            if denominator > 1e-8:
                implied_corr = max(0.0, min(1.0, numerator / denominator))
            else:
                implied_corr = 0.50

        crp = implied_corr - tenor_data.realized_corr

        return ImpliedCorrelationTenorResult(
            tenor_years=round(tenor_data.tenor_years, 4),
            implied_corr=round(implied_corr, 4),
            realized_corr=round(tenor_data.realized_corr, 4),
            correlation_risk_premium=round(crp, 4),
            index_var=round(idx_var, 6),
            weighted_single_var=round(weighted_single_var, 6),
            max_theoretical_var=round(max_theoretical_var, 6),
            is_arbitrage_breach=is_breach,
        )

    def evaluate_term_structure(
        self,
        tenor_curve: List[TenorConstituentVols],
        current_time_sec: float = 0.0,
    ) -> CorrelationTermStructureAssessment:
        """
        Synthesizes implied correlation across multiple expiries into term slope,
        systemic crash warnings, or dispersion alpha directives.
        """
        rationales: List[str] = []
        if not tenor_curve:
            return CorrelationTermStructureAssessment(
                timestamp_sec=current_time_sec,
                tenor_results=[],
                term_slope=0.0,
                average_implied_corr=0.50,
                average_crp=0.0,
                regime=CorrelationRegimeState.IDIOSYNCRATIC_ALPHA_TRANQUIL,
                directive=CorrelationExecutionDirective.ALLOCATE_IDIOSYNCRATIC_MOMENTUM,
                dispersion_hedge_ratio=0.0,
                rationales=["No tenor data supplied."],
            )

        # Sort by tenor
        sorted_curve = sorted(tenor_curve, key=lambda x: x.tenor_years)
        results = [self.compute_tenor_implied_correlation(td) for td in sorted_curve]

        avg_rho = sum(r.implied_corr for r in results) / len(results)
        avg_crp = sum(r.correlation_risk_premium for r in results) / len(results)

        # Term structure slope (linear fit or near vs far)
        if len(results) >= 2:
            dt = results[-1].tenor_years - results[0].tenor_years
            term_slope = (results[-1].implied_corr - results[0].implied_corr) / max(0.01, dt)
        else:
            term_slope = 0.0

        has_arb = any(r.is_arbitrage_breach for r in results)
        front_rho = results[0].implied_corr

        # Decision State Machine
        # 1. Arbitrage Boundary Breach
        if has_arb:
            regime = CorrelationRegimeState.ARBITRAGE_CORRELATION_BOUNDARY
            directive = CorrelationExecutionDirective.EXECUTE_INDEX_BASIS_ARBITRAGE
            dispersion_ratio = 1.0
            rationales.append(
                "Index implied volatility breaches theoretical sum-of-parts boundaries (rho < 0 or rho > 1). Execute statistical index-constituent basis arbitrage."
            )

        # 2. Systemic Crash Panic (High front correlation or heavily inverted term structure)
        elif front_rho >= self.systemic_crash_threshold or term_slope <= self.inverted_slope_threshold:
            regime = CorrelationRegimeState.SYSTEMIC_CORRELATION_CRASH_PANIC
            directive = CorrelationExecutionDirective.DEPLOY_SYSTEMIC_MACRO_COLLAR
            dispersion_ratio = 0.0
            rationales.append(
                f"Systemic correlation spike detected (Front rho={front_rho*100:.1f}%, slope={term_slope:.2f}). Market in indiscriminate deleveraging panic. Deploy macro put collar."
            )

        # 3. Profitable Dispersion Harvesting
        elif avg_crp >= self.rich_crp_threshold:
            regime = CorrelationRegimeState.CORRELATION_DISPERSION_HARVEST
            directive = CorrelationExecutionDirective.HARVEST_CORRELATION_DISPERSION
            dispersion_ratio = min(1.0, max(0.40, avg_crp * 3.0))
            rationales.append(
                f"Correlation Risk Premium highly attractive (avg CRP=+{avg_crp*100:.1f}%). Harvest dispersion: sell index options, buy single-stock constituent options."
            )

        # 4. Tranquil Idiosyncratic Alpha
        else:
            regime = CorrelationRegimeState.IDIOSYNCRATIC_ALPHA_TRANQUIL
            directive = CorrelationExecutionDirective.ALLOCATE_IDIOSYNCRATIC_MOMENTUM
            dispersion_ratio = 0.0
            rationales.append(
                f"Implied correlation benign (avg rho={avg_rho*100:.1f}%). Stock diversification intact; maximize individual stock alpha momentum."
            )

        return CorrelationTermStructureAssessment(
            timestamp_sec=current_time_sec,
            tenor_results=results,
            term_slope=round(term_slope, 4),
            average_implied_corr=round(avg_rho, 4),
            average_crp=round(avg_crp, 4),
            regime=regime,
            directive=directive,
            dispersion_hedge_ratio=round(dispersion_ratio, 3),
            rationales=rationales,
        )
