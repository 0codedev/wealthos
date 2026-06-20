r"""Real-Time Options Surface Wing Kurtosis Extreme Value Theory (EVT) Sieve (Domain 221 / WP-DS)
WealthOS Sovereign Quantitative Research & Trading Fabric

Implements:
1. Pickands-Balkema-de Haan Peaks-Over-Threshold (POT) Generalized Pareto Distribution (GPD) kernel.
2. Options implied wing kurtosis index \mathcal{K}_{wing} = \sigma_{10\Delta} / \sigma_{50\Delta}.
3. Dynamic closed-form EVT Value-at-Risk (VaR_{99}) and Expected Shortfall (ES_{99}) estimation.
4. Black swan tail crash risk classifier, leverage throttling governor, and convex wing hedge sentry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple


class TailKurtosisRegime(Enum):
    """Classification of options surface wing heaviness and tail risk."""
    GAUSSIAN_THIN_TAILS = "GAUSSIAN_THIN_TAILS"         # xi <= 0.15, normal diffusion
    FAT_TAIL_KURTOSIS_ELEVATION = "FAT_TAIL_KURTOSIS_ELEVATION" # 0.15 < xi <= 0.35, high wing premium
    CRASH_REGIME_EXTREME_EVT = "CRASH_REGIME_EXTREME_EVT" # xi > 0.35, systemic crash hazard


class TailTacticalPosture(Enum):
    """Recommended execution and portfolio hedging posture."""
    MAINTAIN_NORMAL_RISK = "MAINTAIN_NORMAL_RISK"
    SELL_OVERPRICED_WINGS = "SELL_OVERPRICED_WINGS"     # 1x2 put ratio / strangle harvest
    BUY_DEEP_OTM_CONVEX_HEDGE = "BUY_DEEP_OTM_CONVEX_HEDGE" # Mandatory crash tail put overlay; cut leverage 50%


@dataclass
class EVTTailDiagnosticsResult:
    """Quantitative diagnostics for options surface wing kurtosis and tail risk."""
    symbol: str
    atm_vol_50_delta: float
    put_wing_vol_10_delta: float
    call_wing_vol_10_delta: float
    wing_kurtosis_ratio: float         # sigma_10P / sigma_50ATM
    gpd_shape_xi: float                # Fréchet tail index
    gpd_scale_beta: float              # Scale parameter
    var_99_1day_pct: float             # 99% Value-at-Risk in %
    expected_shortfall_99_pct: float   # 99% Expected Shortfall (CVaR) in %
    tail_regime: TailKurtosisRegime
    recommended_posture: TailTacticalPosture
    max_portfolio_leverage_multiplier: float
    tactical_directive: str


class OptionsWingKurtosisEVTSieve:
    r"""Options Surface Wing Kurtosis & Extreme Value Theory Sieve.
    
    Mathematical Formulation:
    1. Generalized Pareto Distribution (GPD):
       G_{\xi, \beta}(y) = 1 - \left( 1 + \xi \frac{y}{\beta} \right)^{-1/\xi}
       
    2. Hill Tail Index Estimator:
       \hat{\xi} = \frac{1}{k} \sum_{i=1}^k \ln\left(\frac{x_i}{u}\right)
       
    3. Extreme Quantiles:
       VaR_\alpha = u + \frac{\beta}{\xi} \left[ \left(\frac{N}{N_u} (1 - \alpha)\right)^{-\xi} - 1 \right]
       ES_\alpha = \frac{VaR_\alpha + \beta - \xi u}{1 - \xi}
       
    4. Options Wing Kurtosis:
       \mathcal{K}_{\text{wing}} = \frac{\sigma_{\text{implied}}(K_{10\Delta}^{\text{put}})}{\sigma_{\text{implied}}(K_{50\Delta})}
    """

    def __init__(
        self,
        critical_xi_threshold: float = 0.35,
        elevated_xi_threshold: float = 0.15,
        critical_kurtosis_ratio: float = 1.55,
    ) -> None:
        self.crit_xi = critical_xi_threshold
        self.elev_xi = elevated_xi_threshold
        self.crit_kurt = critical_kurtosis_ratio

    def estimate_gpd_parameters(
        self,
        tail_loss_observations: List[float],
        threshold_quantile: float = 0.90,
    ) -> Tuple[float, float, float]:
        """Estimate POT threshold u, GPD shape xi (via Hill), and scale beta."""
        if len(tail_loss_observations) < 20:
            return 0.02, 0.10, 0.015

        sorted_losses = sorted(tail_loss_observations)
        n = len(sorted_losses)
        k_idx = int(n * threshold_quantile)
        u = sorted_losses[k_idx]

        excesses = [x - u for x in sorted_losses[k_idx:] if x > u]
        if not excesses:
            return u, 0.10, 0.015

        # Hill estimator for xi
        k = len(excesses)
        xi_hill = sum(math.log(1.0 + y / max(u, 1e-4)) for y in excesses) / k
        xi = max(0.01, min(0.85, xi_hill))

        # Method of moments for scale beta: E[Y] = beta / (1 - xi) => beta = E[Y] * (1 - xi)
        mean_excess = sum(excesses) / k
        beta = max(1e-4, mean_excess * (1.0 - xi))

        return round(u, 4), round(xi, 4), round(beta, 4)

    def calculate_var_and_es(
        self,
        u: float,
        xi: float,
        beta: float,
        tail_fraction: float = 0.10, # N_u / N
        confidence_level: float = 0.99,
    ) -> Tuple[float, float]:
        """Compute closed-form 99% VaR and Expected Shortfall using GPD inversion."""
        if xi >= 1.0 or beta <= 0:
            return u * 1.5, u * 2.0

        p = 1.0 - confidence_level # e.g. 0.01
        scaling_term = math.pow((tail_fraction / p), xi)
        var_q = u + (beta / xi) * (scaling_term - 1.0)

        # Expected Shortfall
        es_q = (var_q + beta - xi * u) / (1.0 - xi)
        return max(u, var_q), max(var_q, es_q)

    def evaluate_wing_kurtosis(
        self,
        symbol: str,
        atm_vol: float,
        put_wing_vol: float,
        call_wing_vol: float,
        recent_daily_losses: List[float],
    ) -> EVTTailDiagnosticsResult:
        """Run complete EVT tail risk assessment, wing kurtosis ratio, and tactical risk posture."""
        kurt_ratio = put_wing_vol / max(atm_vol, 0.01)

        u, xi, beta = self.estimate_gpd_parameters(recent_daily_losses)
        var_99, es_99 = self.calculate_var_and_es(u, xi, beta)

        var_pct = var_99 * 100.0
        es_pct = es_99 * 100.0

        # Regimes & Decisions
        if xi >= self.crit_xi or kurt_ratio >= self.crit_kurt:
            regime = TailKurtosisRegime.CRASH_REGIME_EXTREME_EVT
            posture = TailTacticalPosture.BUY_DEEP_OTM_CONVEX_HEDGE
            leverage_mult = 0.50 # Cut portfolio leverage by 50%
            directive = (
                f"CRITICAL CRASH REGIME: GPD tail index xi = {xi:.3f} >= {self.crit_xi:.2f}, "
                f"Wing Kurtosis = {kurt_ratio:.2f}x, 99% ES = {es_pct:.2f}%. "
                f"Mandatory deep OTM crash hedge; cut gross portfolio leverage to {leverage_mult:.1f}x immediately!"
            )
        elif xi >= self.elev_xi or kurt_ratio >= 1.25:
            regime = TailKurtosisRegime.FAT_TAIL_KURTOSIS_ELEVATION
            posture = TailTacticalPosture.SELL_OVERPRICED_WINGS
            leverage_mult = 0.85
            directive = (
                f"ELEVATED WING KURTOSIS: Wing options rich (Kurtosis={kurt_ratio:.2f}x, xi={xi:.3f}). "
                f"99% VaR = {var_pct:.2f}%. Sell overpriced wing ratio spreads with tight delta hedging."
            )
        else:
            regime = TailKurtosisRegime.GAUSSIAN_THIN_TAILS
            posture = TailTacticalPosture.MAINTAIN_NORMAL_RISK
            leverage_mult = 1.0
            directive = (
                f"GAUSSIAN THIN TAILS: Symmetric smile (Kurtosis={kurt_ratio:.2f}x, xi={xi:.3f}). "
                f"99% VaR = {var_pct:.2f}%, ES = {es_pct:.2f}%. Full normal leverage capacity (1.0x)."
            )

        return EVTTailDiagnosticsResult(
            symbol=symbol,
            atm_vol_50_delta=round(atm_vol, 4),
            put_wing_vol_10_delta=round(put_wing_vol, 4),
            call_wing_vol_10_delta=round(call_wing_vol, 4),
            wing_kurtosis_ratio=round(kurt_ratio, 3),
            gpd_shape_xi=xi,
            gpd_scale_beta=beta,
            var_99_1day_pct=round(var_pct, 2),
            expected_shortfall_99_pct=round(es_pct, 2),
            tail_regime=regime,
            recommended_posture=posture,
            max_portfolio_leverage_multiplier=leverage_mult,
            tactical_directive=directive,
        )
