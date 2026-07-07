"""
Unit Tests for Sub-Cent Crypto/FX Cross-Rate Triangular Arbitrage Engine (Domain 120 / WP-V)
"""

from datetime import datetime
import pytest

from services.triangular_arbitrage_engine import (
    TriangularArbitrageEngine,
    TickerQuote,
    ArbitrageSignal,
    ExecutionLegResult,
    BrokenLegRecoveryInstruction,
)


@pytest.fixture
def arb_engine():
    return TriangularArbitrageEngine(
        min_net_hurdle_bps=2.0,
        fixed_slippage_bps=0.5,
        max_position_lots=50,
        db_path=":memory:",
    )


def test_forward_triangular_arb_actionable(arb_engine):
    now = datetime(2026, 10, 18, 10, 30, 0)

    # EURUSD: Bid 1.0850, Ask 1.0852
    q_ab = TickerQuote("EURUSD", 1.0850, 100, 1.0852, 100, now)
    # USDINR: Bid 84.00, Ask 84.01
    q_bc = TickerQuote("USDINR", 84.00, 100, 84.01, 100, now)

    # Synthetic Bid EURINR = 1.0850 * 84.00 = 91.1400
    # Suppose Direct EURINR Ask is artificially low at 91.0500
    # Gross discrepancy = (91.1400 - 91.0500) / 91.0500 * 10000 = ~9.88 bps
    q_ac = TickerQuote("EURINR", 91.0400, 20, 91.0500, 25, now)

    sig = arb_engine.evaluate_triad("EUR/USD/INR", q_ac, q_ab, q_bc)

    assert sig is not None
    assert sig.path == "FORWARD"
    assert sig.gross_discrepancy_bps > 9.0
    assert sig.is_actionable is True
    assert sig.recommended_lots == 25  # Limited by direct ask_size 25


def test_reverse_triangular_arb_actionable(arb_engine):
    now = datetime(2026, 10, 18, 10, 35, 0)

    # EURUSD: Bid 1.0850, Ask 1.0852
    q_ab = TickerQuote("EURUSD", 1.0850, 100, 1.0852, 100, now)
    # USDINR: Bid 84.00, Ask 84.01
    q_bc = TickerQuote("USDINR", 84.00, 100, 84.01, 100, now)

    # Synthetic Ask EURINR = 1.0852 * 84.01 = 91.16765
    # Suppose Direct EURINR Bid is bloated high at 91.2600
    # Gross discrepancy = (91.2600 - 91.16765) / 91.16765 * 10000 = ~10.13 bps
    q_ac = TickerQuote("EURINR", 91.2600, 40, 91.2700, 40, now)

    sig = arb_engine.evaluate_triad("EUR/USD/INR", q_ac, q_ab, q_bc)

    assert sig is not None
    assert sig.path == "REVERSE"
    assert sig.gross_discrepancy_bps > 9.0
    assert sig.is_actionable is True
    assert sig.recommended_lots == 40


def test_sub_hurdle_arb_filtered(arb_engine):
    now = datetime(2026, 10, 18, 10, 40, 0)

    # Tight, efficient market quotes where discrepancy is tiny (e.g. 0.5 bps)
    q_ab = TickerQuote("EURUSD", 1.0850, 100, 1.0851, 100, now)
    q_bc = TickerQuote("USDINR", 84.000, 100, 84.005, 100, now)
    # Synthetic Bid = 91.1400; Ask = 91.1420
    q_ac = TickerQuote("EURINR", 91.1390, 50, 91.1430, 50, now)

    sig = arb_engine.evaluate_triad("EUR/USD/INR", q_ac, q_ab, q_bc)

    assert sig is not None
    # Net alpha is negative or below min hurdle 2.0 bps
    assert sig.is_actionable is False
    assert sig.recommended_lots == 0


def test_broken_leg_recovery_clean_fill(arb_engine):
    results = [
        ExecutionLegResult("EURINR", "BUY", 10, 10, 91.05, "FILLED"),
        ExecutionLegResult("EURUSD", "SELL", 10, 10, 1.0850, "FILLED"),
        ExecutionLegResult("USDINR", "SELL", 10, 10, 84.00, "FILLED"),
    ]

    recovery = arb_engine.audit_atomic_execution(results)
    assert len(recovery) == 0  # No emergency recovery needed


def test_broken_leg_recovery_partial_or_failure(arb_engine):
    results = [
        ExecutionLegResult("EURINR", "BUY", 10, 10, 91.05, "FILLED"),
        ExecutionLegResult("EURUSD", "SELL", 10, 4, 1.0850, "PARTIAL"),
        ExecutionLegResult("USDINR", "SELL", 10, 0, 0.0, "REJECTED"),
    ]

    recovery = arb_engine.audit_atomic_execution(results)
    assert len(recovery) == 2  # Must unwind the 10 EURINR and 4 EURUSD

    # Check EURINR unwind side is SELL
    eurinr_rec = next(r for r in recovery if r.leg_symbol == "EURINR")
    assert eurinr_rec.unwind_side == "SELL"
    assert eurinr_rec.unwind_qty == 10
    assert eurinr_rec.urgency == "EMERGENCY_ATOMIC_100MS"

    # Check EURUSD unwind side is BUY
    eurusd_rec = next(r for r in recovery if r.leg_symbol == "EURUSD")
    assert eurusd_rec.unwind_side == "BUY"
    assert eurusd_rec.unwind_qty == 4


def test_invalid_quote_returns_none(arb_engine):
    now = datetime(2026, 10, 18, 10, 45, 0)
    q_valid = TickerQuote("EURUSD", 1.0850, 100, 1.0852, 100, now)
    q_invalid = TickerQuote("USDINR", 0.0, 0, -1.0, 0, now)

    sig = arb_engine.evaluate_triad("EUR/USD/INR", q_valid, q_valid, q_invalid)
    assert sig is None


def test_sqlite_persistence(arb_engine):
    now = datetime(2026, 10, 18, 10, 50, 0)
    q_ab = TickerQuote("EURUSD", 1.0850, 100, 1.0852, 100, now)
    q_bc = TickerQuote("USDINR", 84.00, 100, 84.01, 100, now)
    q_ac = TickerQuote("EURINR", 91.0400, 20, 91.0500, 25, now)

    arb_engine.evaluate_triad("EUR/USD/INR", q_ac, q_ab, q_bc)

    conn = arb_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT triad_name, path, is_actionable FROM triangular_arb_signals")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "EUR/USD/INR"
    assert row[1] == "FORWARD"
    assert row[2] == 1
