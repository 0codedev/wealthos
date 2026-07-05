"""
Unit Tests for Post-Expiry Gamma Unwind & Pin-Risk Surveillance Engine (Domain 119 / WP-U)
"""

from datetime import datetime, time
import pytest
import sqlite3

from services.post_expiry_gamma_unwinder import (
    PostExpiryGammaUnwinder,
    OptionExpiryPosition,
    GammaCliffAlert,
    MarginTrapAssessment,
    FlatteningInstruction,
)


@pytest.fixture
def unwinder():
    return PostExpiryGammaUnwinder(
        auto_flatten_time=time(15, 15, 0),
        cutoff_margin_time=time(14, 45, 0),
        gamma_cliff_threshold_crores_per_min=-30.0,
        pin_risk_sigma=0.18,
        db_path=":memory:",
    )


def test_gamma_singularity_and_decay(unwinder):
    spot = 24500.0
    strike = 24500.0
    iv = 0.15

    # 1 hour to expiry (1 / (365 * 6.25))
    tte_1h = 1.0 / (365.0 * 6.25)
    gamma_1h = unwinder.calculate_bs_gamma(spot, strike, tte_1h, iv)

    # 5 minutes to expiry
    tte_5m = (5.0 / 60.0) / (365.0 * 6.25)
    gamma_5m = unwinder.calculate_bs_gamma(spot, strike, tte_5m, iv)

    # ATM gamma explodes as T -> 0
    assert gamma_5m > gamma_1h
    assert gamma_5m > 0.0

    # Far OTM gamma approaches zero
    gamma_otm = unwinder.calculate_bs_gamma(spot, 26000.0, tte_5m, iv)
    assert gamma_otm < 1e-4


def test_pinning_risk_index(unwinder):
    spot = 24500.0
    total_oi = 1000000
    tte = 0.001
    iv = 0.15

    # Pinning exactly at the strike with high OI
    pin_high = unwinder.compute_pinning_risk_index(
        spot=spot,
        strike=24500.0,
        oi=300000,
        total_series_oi=total_oi,
        tte_years=tte,
        iv=iv,
    )
    assert 0.0 <= pin_high <= 1.0
    assert pin_high > 0.5

    # Far away strike has near-zero pinning risk
    pin_low = unwinder.compute_pinning_risk_index(
        spot=spot,
        strike=25500.0,
        oi=300000,
        total_series_oi=total_oi,
        tte_years=tte,
        iv=iv,
    )
    assert pin_low < 0.01


def test_gamma_cliff_detection(unwinder):
    strikes_t0 = [
        {"strike": 24500, "call_oi": 100000, "put_oi": 20000, "iv": 0.15},
    ]
    strikes_t1 = [
        {"strike": 24500, "call_oi": 10000, "put_oi": 90000, "iv": 0.15},
    ]

    t0 = datetime(2026, 10, 18, 14, 30, 0)
    alert0 = unwinder.check_gamma_cliff("NIFTY", t0, 24500.0, strikes_t0, 0.001)
    assert alert0.net_gex_crores > 0
    assert not alert0.is_cliff_breached

    # Sudden violent flip in 1 minute
    t1 = datetime(2026, 10, 18, 14, 31, 0)
    alert1 = unwinder.check_gamma_cliff("NIFTY", t1, 24500.0, strikes_t1, 0.001)
    assert alert1.cliff_rate_per_min < -30.0
    assert alert1.is_cliff_breached
    assert alert1.regime == "CLIFF_COLLAPSE"


def test_delivery_margin_assessment_index_safe(unwinder):
    pos = OptionExpiryPosition(
        symbol="NIFTY",
        strike=24500.0,
        option_type="CE",
        expiry_date="2026-10-22",
        side="SELL",
        quantity=50,
        entry_price=120.0,
        lot_size=50,
        is_stock_fno=False,  # Index options are cash settled
    )

    t = datetime(2026, 10, 18, 15, 0, 0)
    assessment = unwinder.assess_physical_delivery_margin_trap(
        position=pos,
        spot_price=24600.0,  # ITM
        current_time=t,
        available_margin=50000.0,
    )
    assert assessment.status == "SAFE"
    assert not assessment.is_delivery_risk
    assert assessment.required_delivery_margin == 0.0


def test_delivery_margin_assessment_stock_itm_trapped(unwinder):
    pos = OptionExpiryPosition(
        symbol="RELIANCE",
        strike=3000.0,
        option_type="CE",
        expiry_date="2026-10-29",
        side="SELL",
        quantity=250,
        entry_price=45.0,
        lot_size=250,
        is_stock_fno=True,  # Stock F&O physical delivery
    )

    # Spot is ITM at 3020; total contract delivery value = 3020 * 250 = INR 7,55,000
    t = datetime(2026, 10, 18, 15, 0, 0)  # past 14:45 cutoff
    assessment = unwinder.assess_physical_delivery_margin_trap(
        position=pos,
        spot_price=3020.0,
        current_time=t,
        available_margin=100000.0,  # Available margin far below 7.55L
    )

    assert assessment.is_delivery_risk
    assert assessment.required_delivery_margin == 3020.0 * 250
    assert assessment.margin_deficit == (3020.0 * 250) - 100000.0
    assert assessment.status == "SEVERELY_TRAPPED"


def test_auto_flattening_schedule_pre_and_post_1515(unwinder):
    pos = OptionExpiryPosition(
        symbol="BANKNIFTY",
        strike=52000.0,
        option_type="PE",
        expiry_date="2026-10-18",
        side="BUY",
        quantity=30,
        entry_price=90.0,
        lot_size=15,
        is_stock_fno=False,
    )

    # 14:00 IST: Normal market session, no auto-flattening
    t_normal = datetime(2026, 10, 18, 14, 0, 0)
    instructions_pre = unwinder.evaluate_auto_flattening_schedule([pos], t_normal)
    assert len(instructions_pre) == 0

    # 15:15:05 IST: Past cutoff, must auto-flatten
    t_post = datetime(2026, 10, 18, 15, 15, 5)
    instructions_post = unwinder.evaluate_auto_flattening_schedule([pos], t_post)
    assert len(instructions_post) == 1
    assert instructions_post[0].unwind_side == "SELL"
    assert instructions_post[0].quantity == 30
    assert instructions_post[0].urgency == "HIGH"


def test_emergency_atomic_flattening_margin_deficit(unwinder):
    pos = OptionExpiryPosition(
        symbol="TCS",
        strike=4000.0,
        option_type="PE",
        expiry_date="2026-10-18",
        side="SELL",
        quantity=175,
        entry_price=20.0,
        lot_size=175,
        is_stock_fno=True,
    )

    t_early = datetime(2026, 10, 18, 14, 50, 0)  # before 15:15, but past 14:45
    trap = unwinder.assess_physical_delivery_margin_trap(
        position=pos,
        spot_price=3980.0,  # ITM PE
        current_time=t_early,
        available_margin=50000.0,
    )
    assert trap.status == "SEVERELY_TRAPPED"

    instructions = unwinder.evaluate_auto_flattening_schedule([pos], t_early, margin_traps=[trap])
    assert len(instructions) == 1
    assert instructions[0].urgency == "EMERGENCY_ATOMIC"
    assert "Physical delivery margin deficit" in instructions[0].reason


def test_sqlite_surveillance_logging(unwinder):
    t0 = datetime(2026, 10, 18, 14, 30, 0)
    unwinder.check_gamma_cliff(
        "NIFTY",
        t0,
        24500.0,
        [{"strike": 24500, "call_oi": 50000, "put_oi": 40000, "iv": 0.15}],
        0.001,
    )

    conn = unwinder._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, spot_price, status FROM expiry_surveillance_logs WHERE symbol = 'NIFTY'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "NIFTY"
    assert row[1] == 24500.0
    assert row[2] == "POSITIVE_STABILIZING"
