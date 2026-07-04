r"""Unit Tests for Real-Time Options Surface Smile Asymmetry & Vanna-Volga PDE Engine (Domain 210 / WP-DH)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.options_vanna_volga_pde_engine import (
    OptionsVannaVolgaPDEEngine,
    SmileAsymmetryRegime,
    VolgaHedgingAction,
)


@pytest.fixture
def engine() -> OptionsVannaVolgaPDEEngine:
    return OptionsVannaVolgaPDEEngine(risk_free_rate=0.065)


def test_bs_greeks_calculation(engine: OptionsVannaVolgaPDEEngine):
    greeks_call = engine.calculate_bs_greeks(
        spot=25000.0,
        strike=25000.0,
        tau=0.25,
        vol=0.18,
        is_call=True,
    )
    assert greeks_call.price > 0.0
    assert 0.45 < greeks_call.delta < 0.60
    assert greeks_call.vega > 0.0
    # At-the-money d1 is near 0, so vanna is well-defined
    assert isinstance(greeks_call.vanna, float)
    assert isinstance(greeks_call.volga, float)

    greeks_put = engine.calculate_bs_greeks(
        spot=25000.0,
        strike=25000.0,
        tau=0.25,
        vol=0.18,
        is_call=False,
    )
    assert greeks_put.price > 0.0
    assert -0.60 < greeks_put.delta < -0.40
    # Put-Call parity approx: C - P = S - K * exp(-r*T)
    c_minus_p = greeks_call.price - greeks_put.price
    parity = 25000.0 - 25000.0 * math.exp(-0.065 * 0.25)
    assert pytest.approx(c_minus_p, 1.0) == parity


def test_vanna_volga_atm_benchmark_recovery(engine: OptionsVannaVolgaPDEEngine):
    # At K = K_atm, the Vanna-Volga adjustment should be minimal
    spot = 25000.0
    k_atm = 25000.0
    k_call25 = 25500.0
    k_put25 = 24500.0
    tau = 0.10
    sigma_atm = 0.16
    sigma_call25 = 0.155
    sigma_put25 = 0.175

    res = engine.price_vanna_volga_option(
        spot=spot,
        strike=k_atm,
        tau=tau,
        k_atm=k_atm,
        k_call25=k_call25,
        k_put25=k_put25,
        sigma_atm=sigma_atm,
        sigma_call25=sigma_call25,
        sigma_put25=sigma_put25,
        is_call=True,
    )

    # Weights at ATM: w_call25 and w_put25 are 0
    assert pytest.approx(res.weights.w_call25, abs=1e-3) == 0.0
    assert pytest.approx(res.weights.w_put25, abs=1e-3) == 0.0
    assert pytest.approx(res.weights.w_atm, abs=1e-3) == 1.0
    assert pytest.approx(res.vanna_volga_price, 0.5) == res.bs_price_atm_vol


def test_normal_smile_equilibrium(engine: OptionsVannaVolgaPDEEngine):
    spot = 25000.0
    k_atm = 25000.0
    k_call25 = 25600.0
    k_put25 = 24400.0
    tau = 0.15
    # Moderate normal equity skew: Put IV 17%, Call IV 15%, ATM 16%
    sigma_atm = 0.16
    sigma_call25 = 0.15
    sigma_put25 = 0.17

    res = engine.price_vanna_volga_option(
        spot=spot,
        strike=25200.0,
        tau=tau,
        k_atm=k_atm,
        k_call25=k_call25,
        k_put25=k_put25,
        sigma_atm=sigma_atm,
        sigma_call25=sigma_call25,
        sigma_put25=sigma_put25,
        is_call=True,
    )

    assert res.smile_regime == SmileAsymmetryRegime.NORMAL_EQUILIBRIUM
    assert res.recommended_action == VolgaHedgingAction.HOLD_DELTA_VEGA_NEUTRAL
    assert res.skew_asymmetry_index < 0.40


def test_panic_downside_skew_dislocation(engine: OptionsVannaVolgaPDEEngine):
    spot = 25000.0
    k_atm = 25000.0
    k_call25 = 25600.0
    k_put25 = 24400.0
    tau = 0.15
    # Massive put skew dislocation: Put IV 27%, Call IV 14%, ATM 16%
    sigma_atm = 0.16
    sigma_call25 = 0.14
    sigma_put25 = 0.27

    res = engine.price_vanna_volga_option(
        spot=spot,
        strike=24400.0,
        tau=tau,
        k_atm=k_atm,
        k_call25=k_call25,
        k_put25=k_put25,
        sigma_atm=sigma_atm,
        sigma_call25=sigma_call25,
        sigma_put25=sigma_put25,
        is_call=False,
    )

    assert res.smile_regime == SmileAsymmetryRegime.PANIC_DOWNSIDE_SKEW
    assert res.recommended_action == VolgaHedgingAction.EXPLOIT_SKEW_REVERSAL
    assert res.skew_asymmetry_index > 0.40
    assert "Sell expensive put risk-reversal" in res.tactical_directive


def test_excess_wing_convexity(engine: OptionsVannaVolgaPDEEngine):
    spot = 25000.0
    k_atm = 25000.0
    k_call25 = 25600.0
    k_put25 = 24400.0
    tau = 0.15
    # Symmetrical wing expansion (both wings trading 23% vs ATM 16%)
    sigma_atm = 0.16
    sigma_call25 = 0.23
    sigma_put25 = 0.23

    res = engine.price_vanna_volga_option(
        spot=spot,
        strike=25600.0,
        tau=tau,
        k_atm=k_atm,
        k_call25=k_call25,
        k_put25=k_put25,
        sigma_atm=sigma_atm,
        sigma_call25=sigma_call25,
        sigma_put25=sigma_put25,
        is_call=True,
    )

    assert res.smile_regime == SmileAsymmetryRegime.EXCESS_WING_CONVEXITY
    assert res.recommended_action == VolgaHedgingAction.SELL_OVERPRICED_WINGS
    assert res.smile_curvature_index > 0.15
    assert "Sell 25-delta strangle, buy ATM straddle" in res.tactical_directive
