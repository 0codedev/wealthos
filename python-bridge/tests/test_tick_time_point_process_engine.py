r"""Unit Tests for Cross-Market Microstructure Tick-Time Point Process & Self-Exciting Trade Engine (Domain 199 / WP-CW)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import math
import pytest
from services.tick_time_point_process_engine import (
    TickTimePointProcessEngine,
    HawkesParameters,
    MarketEvent,
    CascadeRiskRegime,
    OrderFlowIntensitySignal,
)


@pytest.fixture
def engine() -> TickTimePointProcessEngine:
    params = HawkesParameters(
        mu_plus=0.50,
        mu_minus=0.50,
        alpha_pp=0.45,
        alpha_pm=0.10,
        alpha_mp=0.10,
        alpha_mm=0.45,
        beta=1.20,
        volume_gamma=0.60,
        avg_volume=100.0,
    )
    return TickTimePointProcessEngine(params=params)


def test_spectral_radius_and_stability(engine: TickTimePointProcessEngine):
    # Stable parameters
    rho = engine.compute_spectral_radius()
    # (0.45 + 0.10) / 1.20 = 0.55 / 1.20 = 0.4583 < 0.60
    assert 0.40 <= rho <= 0.55

    # Supercritical parameters: high alpha relative to beta
    crit_params = HawkesParameters(
        alpha_pp=1.10,
        alpha_pm=0.30,
        alpha_mp=0.30,
        alpha_mm=1.10,
        beta=1.20,
    )
    rho_crit = engine.compute_spectral_radius(crit_params)
    assert rho_crit > 1.0


def test_calculate_intensities_empty_baseline(engine: TickTimePointProcessEngine):
    snapshot = engine.calculate_intensities(events=[], current_time_s=100.0)
    assert snapshot.lambda_plus == 0.50
    assert snapshot.lambda_minus == 0.50
    assert snapshot.total_intensity == 1.00
    assert snapshot.iofir == 0.0
    assert snapshot.signal == OrderFlowIntensitySignal.NEUTRAL_FLOW
    assert snapshot.cascade_regime == CascadeRiskRegime.SUBCRITICAL_STABLE


def test_buy_excitation_burst(engine: TickTimePointProcessEngine):
    # Burst of 12 consecutive aggressive buy trades in 1.2 seconds
    t0 = 10.0
    events = [
        MarketEvent(timestamp_s=t0 + i * 0.1, side="BUY", volume=200.0, price=25000.0 + i)
        for i in range(12)
    ]

    snapshot = engine.calculate_intensities(events=events, current_time_s=t0 + 1.25)
    # Buy intensity should surge above baseline
    assert snapshot.lambda_plus > 3.00
    assert snapshot.lambda_plus > snapshot.lambda_minus * 2.0
    assert snapshot.iofir > 0.45
    assert snapshot.signal == OrderFlowIntensitySignal.STRONG_BUY_SURGE

    directive = engine.evaluate_execution_directive(snapshot)
    assert directive["action"] == "AGGRESSIVE_MOMENTUM_BUY"
    assert directive["urgency"] == "HIGH"


def test_marked_volume_amplification(engine: TickTimePointProcessEngine):
    t_curr = 20.0
    # Small order of 50 units
    event_small = [MarketEvent(timestamp_s=19.5, side="BUY", volume=50.0, price=25000.0)]
    snap_small = engine.calculate_intensities(events=event_small, current_time_s=t_curr)

    # Giant block order of 1000 units
    event_block = [MarketEvent(timestamp_s=19.5, side="BUY", volume=1000.0, price=25000.0)]
    snap_block = engine.calculate_intensities(events=event_block, current_time_s=t_curr)

    assert snap_block.lambda_plus > snap_small.lambda_plus * 2.0


def test_hawkes_parameters_mle_and_directives(engine: TickTimePointProcessEngine):
    # Sequence of 30 alternating trades
    events = []
    for i in range(30):
        side = "BUY" if i % 3 != 0 else "SELL"
        events.append(MarketEvent(timestamp_s=i * 0.5, side=side, volume=120.0, price=25000.0))

    fitted = engine.fit_hawkes_parameters_mle(events)
    assert fitted.mu_plus > 0.0
    assert fitted.mu_minus > 0.0
    assert fitted.beta > 0.0
    assert fitted.avg_volume == 120.0

    # Ensure engine with fitted params maintains stable subcritical radius
    engine_fitted = TickTimePointProcessEngine(params=fitted)
    rho_fit = engine_fitted.compute_spectral_radius()
    assert rho_fit < 0.85
