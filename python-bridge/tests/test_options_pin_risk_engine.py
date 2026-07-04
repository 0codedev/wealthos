"""
Unit Tests for Real-Time Options Pin Risk & Max Pain Gamma Gravity Engine (Domain 162 / WP-BL)
"""

import pytest
from services.options_pin_risk_engine import (
    OptionsPinRiskEngine,
    StrikeOpenInterest,
    PinRiskReport,
)


@pytest.fixture
def engine():
    return OptionsPinRiskEngine(
        db_path=":memory:",
        pin_prob_hurdle=0.65,
        max_pin_distance_pct=0.75,
    )


def test_calculate_max_pain_exact(engine):
    # Strike OI table:
    # 23900: Call 1000, Put 50000
    # 24000: Call 40000, Put 40000 (Symmetric heavy peak)
    # 24100: Call 50000, Put 1000
    strikes = [
        StrikeOpenInterest(23900.0, call_oi=1000, put_oi=50000),
        StrikeOpenInterest(24000.0, call_oi=40000, put_oi=40000),
        StrikeOpenInterest(24100.0, call_oi=50000, put_oi=1000),
    ]

    max_pain = engine.calculate_max_pain(strikes)
    assert max_pain == 24000.0


def test_imminent_expiry_strike_pin(engine):
    strikes = [
        StrikeOpenInterest(23900.0, call_oi=2000, put_oi=40000, call_gamma=0.001, put_gamma=0.001),
        StrikeOpenInterest(24000.0, call_oi=50000, put_oi=50000, call_gamma=0.008, put_gamma=0.008),
        StrikeOpenInterest(24100.0, call_oi=40000, put_oi=2000, call_gamma=0.001, put_gamma=0.001),
    ]

    # Spot is 24010 at 14:15 IST (1.25 hours left)
    rep = engine.evaluate_pin_risk(
        symbol="NIFTY",
        underlying_price=24010.0,
        hours_to_expiry=1.25,
        strikes_oi=strikes,
    )

    assert rep.max_pain_strike == 24000.0
    assert rep.distance_to_pin_pct < 0.10
    assert rep.pin_probability >= 0.65
    assert rep.regime == "IMMINENT_EXPIRY_STRIKE_PIN"
    assert rep.trade_directive == "FADE_TOWARD_PIN_STRIKE_IRON_BUTTERFLY"
    assert rep.gamma_restoring_force < 0.0  # Pulling down towards 24000


def test_gamma_pin_escape_breakout(engine):
    strikes = [
        StrikeOpenInterest(24000.0, call_oi=50000, put_oi=50000, call_gamma=0.001, put_gamma=0.001),
        StrikeOpenInterest(24500.0, call_oi=1000, put_oi=1000, call_gamma=0.001, put_gamma=0.001),
    ]

    # Spot escaped to 24500 with 1.2 hours left (dist > 2%)
    rep = engine.evaluate_pin_risk(
        symbol="NIFTY",
        underlying_price=24500.0,
        hours_to_expiry=1.2,
        strikes_oi=strikes,
    )

    assert rep.distance_to_pin_pct > 1.50
    assert rep.pin_probability < 0.25
    assert rep.regime == "GAMMA_PIN_ESCAPE_BREAKOUT"
    assert rep.trade_directive == "BUY_MOMENTUM_RUNNER_AWAY_FROM_STRIKE"


def test_early_expiry_cycle(engine):
    strikes = [StrikeOpenInterest(24000.0, call_oi=10000, put_oi=10000)]
    rep = engine.evaluate_pin_risk("NIFTY", 24000.0, hours_to_expiry=6.0, strikes_oi=strikes)

    assert rep.regime == "EARLY_EXPIRY_CYCLE_MONITORING"
    assert rep.trade_directive == "STAND_ASIDE_WAIT_FINAL_SESSION"


def test_gamma_restoring_force_polarity(engine):
    strikes = [StrikeOpenInterest(24000.0, call_oi=20000, put_oi=20000, call_gamma=0.005, put_gamma=0.005)]

    # When price is below pin strike (23950 vs 24000) -> force must be positive (pulling upward)
    rep_below = engine.evaluate_pin_risk("NIFTY", 23950.0, 1.5, strikes)
    assert rep_below.gamma_restoring_force > 0.0

    # When price is above pin strike (24050 vs 24000) -> force must be negative (pulling downward)
    rep_above = engine.evaluate_pin_risk("NIFTY", 24050.0, 1.5, strikes)
    assert rep_above.gamma_restoring_force < 0.0


def test_sqlite_persistence(engine):
    strikes = [StrikeOpenInterest(100.0, call_oi=1000, put_oi=1000)]
    engine.evaluate_pin_risk("PERSIST_SYM", 100.0, 1.0, strikes)

    conn = engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, max_pain_strike, regime FROM options_pin_risk_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
