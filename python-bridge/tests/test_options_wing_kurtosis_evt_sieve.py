r"""Unit Tests for Real-Time Options Surface Wing Kurtosis Extreme Value Theory (EVT) Sieve (Domain 221 / WP-DS)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.options_wing_kurtosis_evt_sieve import (
    OptionsWingKurtosisEVTSieve,
    TailKurtosisRegime,
    TailTacticalPosture,
)


@pytest.fixture
def sieve() -> OptionsWingKurtosisEVTSieve:
    return OptionsWingKurtosisEVTSieve(
        critical_xi_threshold=0.35,
        elevated_xi_threshold=0.15,
        critical_kurtosis_ratio=1.55,
    )


def test_var_and_es_monotonicity(sieve: OptionsWingKurtosisEVTSieve):
    u = 0.02
    xi = 0.20
    beta = 0.015

    var_99, es_99 = sieve.calculate_var_and_es(u, xi, beta)
    assert es_99 > var_99 > u
    assert var_99 > 0.02


def test_insufficient_loss_samples_fallback(sieve: OptionsWingKurtosisEVTSieve):
    u, xi, beta = sieve.estimate_gpd_parameters([0.01, 0.02, 0.03])
    assert u == 0.02
    assert xi == 0.10
    assert beta == 0.015


def test_gaussian_thin_tails(sieve: OptionsWingKurtosisEVTSieve):
    # Gaussian losses: 100 days of small drawdowns
    losses = [0.005 + 0.001 * (i % 10) for i in range(100)]

    res = sieve.evaluate_wing_kurtosis(
        symbol="NIFTY",
        atm_vol=0.16,
        put_wing_vol=0.18, # 1.125x
        call_wing_vol=0.15,
        recent_daily_losses=losses,
    )

    assert res.wing_kurtosis_ratio <= 1.25
    assert res.tail_regime == TailKurtosisRegime.GAUSSIAN_THIN_TAILS
    assert res.recommended_posture == TailTacticalPosture.MAINTAIN_NORMAL_RISK
    assert res.max_portfolio_leverage_multiplier == 1.0
    assert "Full normal leverage capacity" in res.tactical_directive


def test_fat_tail_kurtosis_elevation(sieve: OptionsWingKurtosisEVTSieve):
    losses = [0.005 + 0.002 * (i % 15) for i in range(100)]

    res = sieve.evaluate_wing_kurtosis(
        symbol="BANKNIFTY",
        atm_vol=0.16,
        put_wing_vol=0.22, # 1.375x
        call_wing_vol=0.17,
        recent_daily_losses=losses,
    )

    assert 1.25 <= res.wing_kurtosis_ratio < 1.55
    assert res.tail_regime == TailKurtosisRegime.FAT_TAIL_KURTOSIS_ELEVATION
    assert res.recommended_posture == TailTacticalPosture.SELL_OVERPRICED_WINGS
    assert res.max_portfolio_leverage_multiplier == 0.85
    assert "Sell overpriced wing ratio spreads" in res.tactical_directive


def test_crash_regime_extreme_evt(sieve: OptionsWingKurtosisEVTSieve):
    # Extreme tail losses up to 10%
    losses = [0.01 * (i % 10) for i in range(90)] + [0.05, 0.07, 0.08, 0.09, 0.10] * 2

    res = sieve.evaluate_wing_kurtosis(
        symbol="RELIANCE",
        atm_vol=0.16,
        put_wing_vol=0.28, # 1.75x (> 1.55)
        call_wing_vol=0.18,
        recent_daily_losses=losses,
    )

    assert res.wing_kurtosis_ratio >= 1.55
    assert res.tail_regime == TailKurtosisRegime.CRASH_REGIME_EXTREME_EVT
    assert res.recommended_posture == TailTacticalPosture.BUY_DEEP_OTM_CONVEX_HEDGE
    assert res.max_portfolio_leverage_multiplier == 0.50
    assert "cut gross portfolio leverage to 0.5x immediately!" in res.tactical_directive
