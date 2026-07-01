"""
Unit Tests for Dynamic Delta-Neutral Gamma Scalping Execution Scheduler (Domain 154 / WP-BD)
"""

import pytest
from services.gamma_scalping_scheduler import (
    GammaScalpingScheduler,
    PortfolioGreeks,
    GammaScalpReport,
)


@pytest.fixture
def scheduler():
    return GammaScalpingScheduler(
        db_path=":memory:",
        transaction_cost_rate=0.0005,
        delta_tolerance=0.15,
        risk_aversion=1.0,
    )


def test_leland_rebalance_band_calculation(scheduler):
    band_price, band_delta = scheduler.calculate_leland_rebalance_band(
        price=24000.0,
        gamma=0.005,
        vol=0.15,
    )
    assert band_price > 0.0
    assert 0.0 < band_delta <= scheduler.delta_tolerance


def test_long_gamma_positive_scalp_upmove(scheduler):
    # Long gamma portfolio (e.g. Long Straddle)
    # Underlying surged, delta drifted to +0.40 (> tolerance 0.15)
    greeks = PortfolioGreeks(
        underlying_price=24500.0,
        net_delta=0.40,
        net_gamma=0.008,
        net_vega=150.0,
        net_theta=-450.0,
        underlying_hedge_qty=0.0,
        implied_vol=0.14,
        realized_vol_30d=0.18,  # Realized vol > Implied vol -> Positive vol harvest
    )

    rep = scheduler.evaluate_gamma_scalp("NIFTY", greeks)

    assert rep.total_delta == 0.40
    assert rep.required_hedge_delta == pytest.approx(-0.40, abs=1e-4)
    assert rep.hedge_action == "SELL_UNDERLYING_HEDGE"
    assert rep.regime == "POSITIVE_VOL_HARVEST_ACTIVE_SCALPING"
    assert rep.trade_directive == "SCALP_HARVEST_UPMOVE_SELL_HEDGE"
    assert rep.vol_spread_real_minus_impl > 0.0


def test_long_gamma_positive_scalp_dip(scheduler):
    # Underlying dropped, delta drifted to -0.35
    greeks = PortfolioGreeks(
        underlying_price=23800.0,
        net_delta=-0.35,
        net_gamma=0.008,
        net_vega=150.0,
        net_theta=-450.0,
        underlying_hedge_qty=0.0,
        implied_vol=0.14,
        realized_vol_30d=0.18,
    )

    rep = scheduler.evaluate_gamma_scalp("NIFTY", greeks)

    assert rep.total_delta == -0.35
    assert rep.required_hedge_delta == pytest.approx(0.35, abs=1e-4)
    assert rep.hedge_action == "BUY_UNDERLYING_HEDGE"
    assert rep.trade_directive == "SCALP_HARVEST_DIP_BUY_HEDGE"


def test_within_band_neutral_idle(scheduler):
    # Total delta is well within tolerance (+0.02 vs 0.15)
    greeks = PortfolioGreeks(
        underlying_price=24000.0,
        net_delta=0.02,
        net_gamma=0.005,
        net_vega=100.0,
        net_theta=-300.0,
        underlying_hedge_qty=0.0,
        implied_vol=0.15,
        realized_vol_30d=0.15,
    )

    rep = scheduler.evaluate_gamma_scalp("NIFTY", greeks)

    assert rep.hedge_action == "NO_HEDGE_WITHIN_BAND"
    assert rep.required_hedge_delta == 0.0
    assert rep.regime == "DELTA_NEUTRAL_IDLE_MONITORING"
    assert rep.trade_directive == "MAINTAIN_CURRENT_HEDGE"


def test_short_gamma_defensive_hedge(scheduler):
    # Short gamma book (net_gamma = -0.006), market spikes delta to +0.30
    greeks = PortfolioGreeks(
        underlying_price=51000.0,
        net_delta=0.30,
        net_gamma=-0.006,
        net_vega=-200.0,
        net_theta=600.0,
        underlying_hedge_qty=0.0,
        implied_vol=0.18,
        realized_vol_30d=0.14,
    )

    rep = scheduler.evaluate_gamma_scalp("BANKNIFTY", greeks)

    assert rep.hedge_action == "SELL_UNDERLYING_HEDGE"
    assert rep.trade_directive == "DEFENSIVE_SHORT_GAMMA_STOP_HEDGE"
    assert rep.regime == "SHORT_GAMMA_DELTA_DEVIATION_CORRECTION"


def test_sqlite_persistence(scheduler):
    greeks = PortfolioGreeks(
        underlying_price=100.0,
        net_delta=0.25,
        net_gamma=0.01,
        net_vega=10.0,
        net_theta=-5.0,
        underlying_hedge_qty=0.0,
        implied_vol=0.20,
        realized_vol_30d=0.22,
    )
    scheduler.evaluate_gamma_scalp("PERSIST_SYM", greeks)

    conn = scheduler._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, underlying_price, total_delta, hedge_action FROM gamma_scalping_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
