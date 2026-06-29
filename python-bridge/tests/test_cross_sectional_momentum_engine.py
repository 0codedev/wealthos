"""
Unit Tests for Cross-Sectional Momentum & Idiosyncratic Volatility Acceleration Engine (Domain 157 / WP-BG)
"""

import math
import pytest
from services.cross_sectional_momentum_engine import (
    CrossSectionalMomentumEngine,
    EquityPriceHistory,
    MomentumAnalysisReport,
)


@pytest.fixture
def engine():
    return CrossSectionalMomentumEngine(
        db_path=":memory:",
        top_percentile_hurdle=0.75,
        ivol_ceiling=0.35,
    )


def test_calculate_r_12_1(engine):
    # 260 daily prices: prices[-252] is 100.0, prices[-21] is 150.0 -> exact 50% gain
    prices = [100.0] * 260
    i_start = 260 - 252
    i_end = 260 - 21
    for i in range(i_start, 260):
        if i <= i_end:
            prices[i] = 100.0 + (50.0 * ((i - i_start) / (i_end - i_start)))
        else:
            prices[i] = 150.0

    r = engine.calculate_r_12_1(prices)
    assert r == pytest.approx(0.50, abs=1e-3)


def test_calculate_ivol_60d(engine):
    # Market prices flat, stock prices oscillate with known daily standard deviation
    mkt = [100.0] * 70
    stock = [100.0 + (1.0 if i % 2 == 0 else -1.0) for i in range(70)]

    ivol = engine.calculate_ivol_60d(stock, mkt)
    assert ivol > 0.10
    assert ivol < 0.40


def test_calculate_momentum_acceleration(engine):
    # Accelerating series: exponential surge in recent 21 bars
    prices = [100.0 + 0.1 * i for i in range(220)]
    # Last 42 bars accelerate
    for i in range(220, 260):
        prices.append(prices[-1] + 1.5 * (i - 219))

    accel = engine.calculate_momentum_acceleration(prices)
    assert accel > 0.0


def test_high_conviction_quality_momentum_runner(engine):
    # Create universe of 5 stocks
    mkt = [100.0 * (1.0 + 0.0002 * i) for i in range(260)]

    # Winner: steady smooth uptrend (low IVOL, high momentum)
    p_winner = [100.0 * (1.0 + 0.002 * i) for i in range(260)]
    winner = EquityPriceHistory("WINNER", p_winner, mkt)

    # Median stocks
    med1 = EquityPriceHistory("MED1", [100.0 * (1.0 + 0.0005 * i) for i in range(260)], mkt)
    med2 = EquityPriceHistory("MED2", [100.0 * (1.0 + 0.0003 * i) for i in range(260)], mkt)
    med3 = EquityPriceHistory("MED3", [100.0 * (1.0 + 0.0001 * i) for i in range(260)], mkt)

    # Loser
    loser = EquityPriceHistory("LOSER", [100.0 * (1.0 - 0.001 * i) for i in range(260)], mkt)

    reps = engine.rank_universe_and_evaluate([loser, med3, med2, med1, winner])
    win_rep = next(r for r in reps if r.symbol == "WINNER")

    assert win_rep.percentile_rank == 1.0
    assert win_rep.ivol_annualized < engine.ivol_ceiling
    assert win_rep.regime == "HIGH_CONVICTION_QUALITY_MOMENTUM_RUNNER"
    assert win_rep.trade_directive == "OVERWEIGHT_LONG_ALPHA_RUNNER"


def test_high_ivol_junk_momentum_trap(engine):
    mkt = [100.0] * 260

    # High momentum (r12_1 is huge), but insane lottery volatility (IVOL > 45%)
    p_junk = []
    base = 100.0
    for i in range(260):
        # Huge swings of +/- 8% every day
        swing = 1.08 if i % 2 == 0 else 0.93
        base = base * 1.003 * swing
        p_junk.append(base)

    junk = EquityPriceHistory("JUNK", p_junk, mkt)
    others = [EquityPriceHistory(f"SYM_{k}", [100.0] * 260, mkt) for k in range(4)]

    reps = engine.rank_universe_and_evaluate(others + [junk])
    junk_rep = next(r for r in reps if r.symbol == "JUNK")

    assert junk_rep.percentile_rank >= engine.top_percentile_hurdle
    assert junk_rep.ivol_annualized > engine.ivol_ceiling
    assert junk_rep.regime == "HIGH_IVOL_JUNK_MOMENTUM_TRAP"
    assert junk_rep.trade_directive == "AVOID_LOTTERY_EXPOSURE"


def test_persistent_cross_sectional_loser(engine):
    mkt = [100.0] * 260
    loser = EquityPriceHistory("COLLAPSE", [100.0 * (1.0 - 0.002 * i) for i in range(260)], mkt)
    others = [EquityPriceHistory(f"SYM_{k}", [100.0 * (1.0 + 0.001 * i) for i in range(260)], mkt) for k in range(4)]

    reps = engine.rank_universe_and_evaluate([loser] + others)
    loser_rep = next(r for r in reps if r.symbol == "COLLAPSE")

    assert loser_rep.percentile_rank <= 0.20
    assert loser_rep.regime == "PERSISTENT_CROSS_SECTIONAL_LOSER"
    assert loser_rep.trade_directive == "UNDERWEIGHT_OR_SHORT_MOMENTUM_FADE"


def test_sqlite_persistence(engine):
    mkt = [100.0] * 260
    stock = [100.0 + 0.1 * i for i in range(260)]
    engine.rank_universe_and_evaluate([EquityPriceHistory("PERSIST_SYM", stock, mkt)])

    conn = engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT symbol, percentile_rank, regime FROM cross_sectional_momentum_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "PERSIST_SYM"
