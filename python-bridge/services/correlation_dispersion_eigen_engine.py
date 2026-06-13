"""
Cross-Asset Realized Correlation Dispersion & Multi-Factor Eigen-Variance Arbitrage Engine
Domain 262 / Work Package WP-FH

Solves CBOE equicorrelation implied versus realized correlation risk premia (CRP),
decomposes cross-sectional variance into market and idiosyncratic eigen-components,
and dispatches vega-neutral index-versus-constituents volatility dispersion arbitrage.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class DispersionArbitrageRegime(str, Enum):
    DISPERSION_EQUILIBRIUM = "DISPERSION_EQUILIBRIUM"                  # CRP in [-0.15, +0.15], fair correlation pricing
    CORRELATION_PREMIUM_SHORT_INDEX_LONG_BASKET = "CORRELATION_PREMIUM_SHORT_INDEX_LONG_BASKET"  # CRP >= +0.15, short index / long components
    CORRELATION_COMPRESSION_LONG_INDEX_SHORT_BASKET = "CORRELATION_COMPRESSION_LONG_INDEX_SHORT_BASKET" # CRP <= -0.15, long index / short components
    SYSTEMIC_CORRELATION_SPIKE_DEFENSE = "SYSTEMIC_CORRELATION_SPIKE_DEFENSE" # Realized rho >= 0.85, panic correlation squeeze


class DispersionTradingDirective(str, Enum):
    MAINTAIN_PASSIVE_MONITORING = "MAINTAIN_PASSIVE_MONITORING"        # Passive monitoring, no trade
    EXECUTE_SHORT_INDEX_LONG_BASKET = "EXECUTE_SHORT_INDEX_LONG_BASKET" # Sell index variance swap, buy constituent variance swaps
    EXECUTE_LONG_INDEX_SHORT_BASKET = "EXECUTE_LONG_INDEX_SHORT_BASKET" # Buy index variance swap, sell constituent variance swaps
    EMERGENCY_DISPERSION_CIRCUIT_ABORT = "EMERGENCY_DISPERSION_CIRCUIT_ABORT" # Abort dispersion positions; systemic lockstep crash


@dataclass
class ComponentVarianceInput:
    symbol: str
    weight: float
    implied_vol: float                 # Annualized IV (e.g. 0.30 = 30%)
    realized_vol: float                # Annualized RV (e.g. 0.25 = 25%)


@dataclass
class DispersionMarketState:
    index_symbol: str
    index_implied_vol: float           # Index IV (e.g. 0.22 = 22%)
    index_realized_vol: float          # Index RV (e.g. 0.16 = 16%)
    components: List[ComponentVarianceInput]
    holding_period_days: float = 30.0


@dataclass
class DispersionAssessment:
    index_symbol: str
    implied_correlation: float
    realized_correlation: float
    correlation_risk_premium: float
    idiosyncratic_dispersion_vol: float
    net_annualized_edge_pct: float
    regime: DispersionArbitrageRegime
    directive: DispersionTradingDirective
    rationales: List[str] = field(default_factory=list)


class CorrelationDispersionEigenEngine:
    """
    Quantitative correlation risk premium solver and multi-asset dispersion allocator.
    """

    def __init__(
        self,
        crp_entry_threshold: float = 0.15,
        systemic_corr_ceiling: float = 0.85,
        min_net_edge_pct: float = 6.0,
    ):
        self.crp_entry_threshold = crp_entry_threshold
        self.systemic_corr_ceiling = systemic_corr_ceiling
        self.min_net_edge_pct = min_net_edge_pct

    def calculate_equicorrelation(
        self, index_vol: float, comp_vols: List[float], weights: List[float]
    ) -> float:
        """
        CBOE equicorrelation formula:
        rho_bar = (sigma_idx^2 - sum w_i^2 * sigma_i^2) / ( (sum w_i * sigma_i)^2 - sum w_i^2 * sigma_i^2 )
        """
        if not comp_vols or not weights or len(comp_vols) != len(weights):
            return 0.5

        sum_w_sigma = sum(w * s for w, s in zip(weights, comp_vols))
        sum_w2_sigma2 = sum((w ** 2) * (s ** 2) for w, s in zip(weights, comp_vols))
        denominator = (sum_w_sigma ** 2) - sum_w2_sigma2

        if denominator <= 1e-8:
            return 0.5

        numerator = (index_vol ** 2) - sum_w2_sigma2
        rho = numerator / denominator
        return max(-1.0, min(1.0, rho))

    def evaluate_dispersion(self, state: DispersionMarketState) -> DispersionAssessment:
        rationales: List[str] = []

        if not state.components:
            return DispersionAssessment(
                index_symbol=state.index_symbol,
                implied_correlation=0.0,
                realized_correlation=0.0,
                correlation_risk_premium=0.0,
                idiosyncratic_dispersion_vol=0.0,
                net_annualized_edge_pct=0.0,
                regime=DispersionArbitrageRegime.DISPERSION_EQUILIBRIUM,
                directive=DispersionTradingDirective.MAINTAIN_PASSIVE_MONITORING,
                rationales=["No components provided."],
            )

        comp_ivs = [c.implied_vol for c in state.components]
        comp_rvs = [c.realized_vol for c in state.components]
        weights = [c.weight for c in state.components]

        # Normalize weights
        total_w = sum(weights)
        if total_w > 0.0:
            weights = [w / total_w for w in weights]

        # 1. Equicorrelation calculations
        rho_imp = self.calculate_equicorrelation(state.index_implied_vol, comp_ivs, weights)
        rho_real = self.calculate_equicorrelation(state.index_realized_vol, comp_rvs, weights)

        # 2. Correlation Risk Premium: CRP = rho_implied - rho_realized
        crp = rho_imp - rho_real

        # 3. Idiosyncratic dispersion variance: sum w_i sigma_i^2 - sigma_idx^2
        weighted_comp_var = sum(w * (s ** 2) for w, s in zip(weights, comp_rvs))
        dispersion_var = max(0.0, weighted_comp_var - (state.index_realized_vol ** 2))
        idiosyncratic_vol = math.sqrt(dispersion_var)

        # 4. Net annualized edge: CRP * average component volatility * 100%
        avg_comp_vol = sum(w * s for w, s in zip(weights, comp_ivs))
        gross_edge_pct = abs(crp) * avg_comp_vol * 100.0
        # Deduct transaction/carrying friction (approx 2.5%)
        net_edge_pct = max(0.0, gross_edge_pct - 2.50)

        # 5. Decision State Machine
        if rho_real >= self.systemic_corr_ceiling:
            regime = DispersionArbitrageRegime.SYSTEMIC_CORRELATION_SPIKE_DEFENSE
            directive = DispersionTradingDirective.EMERGENCY_DISPERSION_CIRCUIT_ABORT
            rationales.append(
                f"Systemic correlation squeeze on {state.index_symbol}: Realized correlation={rho_real:.2f} >= {self.systemic_corr_ceiling:.2f}. "
                f"Market in lockstep crash mode. Abort all dispersion trading immediately."
            )

        elif crp >= self.crp_entry_threshold and net_edge_pct >= self.min_net_edge_pct:
            regime = DispersionArbitrageRegime.CORRELATION_PREMIUM_SHORT_INDEX_LONG_BASKET
            directive = DispersionTradingDirective.EXECUTE_SHORT_INDEX_LONG_BASKET
            rationales.append(
                f"Attractive correlation risk premium on {state.index_symbol}: "
                f"rho_imp={rho_imp:.2f} vs rho_real={rho_real:.2f} (CRP={crp:+.2f}). "
                f"Net edge={net_edge_pct:.1f}% exceeds {self.min_net_edge_pct:.1f}% hurdle. "
                f"Sell index variance, buy constituent basket variance."
            )

        elif crp <= -self.crp_entry_threshold and net_edge_pct >= self.min_net_edge_pct:
            regime = DispersionArbitrageRegime.CORRELATION_COMPRESSION_LONG_INDEX_SHORT_BASKET
            directive = DispersionTradingDirective.EXECUTE_LONG_INDEX_SHORT_BASKET
            rationales.append(
                f"Correlation compression opportunity on {state.index_symbol}: "
                f"rho_imp={rho_imp:.2f} vs rho_real={rho_real:.2f} (CRP={crp:+.2f}). "
                f"Net edge={net_edge_pct:.1f}%. Buy index variance, sell constituent basket variance."
            )

        else:
            regime = DispersionArbitrageRegime.DISPERSION_EQUILIBRIUM
            directive = DispersionTradingDirective.MAINTAIN_PASSIVE_MONITORING
            rationales.append(
                f"Correlation dispersion in equilibrium for {state.index_symbol}: "
                f"rho_imp={rho_imp:.2f}, rho_real={rho_real:.2f} (CRP={crp:+.2f}). "
                f"Net edge={net_edge_pct:.1f}% does not meet entry hurdle."
            )

        return DispersionAssessment(
            index_symbol=state.index_symbol,
            implied_correlation=round(rho_imp, 4),
            realized_correlation=round(rho_real, 4),
            correlation_risk_premium=round(crp, 4),
            idiosyncratic_dispersion_vol=round(idiosyncratic_vol, 4),
            net_annualized_edge_pct=round(net_edge_pct, 2),
            regime=regime,
            directive=directive,
            rationales=rationales,
        )
