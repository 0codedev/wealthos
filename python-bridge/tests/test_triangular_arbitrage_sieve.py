"""
Unit Tests for Cross-Exchange Crypto/Fiat Synthetic Triangular Arbitrage Sieve (Domain 164 / WP-BN)
"""

import pytest
from services.triangular_arbitrage_sieve import (
    TriangularArbitrageSieve,
    CurrencyPairQuote,
    ArbitrageCycleReport,
)


@pytest.fixture
def sieve():
    return TriangularArbitrageSieve(
        db_path=":memory:",
        min_net_profit_bps=15.0,
    )


def test_build_rate_graph(sieve):
    quotes = [
        CurrencyPairQuote(base="USDT", quote="INR", bid=87.95, ask=88.05, fee_rate=0.001),
        CurrencyPairQuote(base="BTC", quote="USDT", bid=65000.0, ask=65100.0, fee_rate=0.001),
    ]
    nodes, gross, net = sieve.build_rate_graph(quotes)

    assert "BTC" in nodes
    assert "USDT" in nodes
    assert "INR" in nodes
    assert ("USDT", "INR") in gross
    assert ("INR", "USDT") in gross
    assert net[("USDT", "INR")] == pytest.approx(87.95 * 0.999, abs=1e-4)


def test_triangular_arbitrage_viable(sieve):
    # Cross rates dislocated:
    # 1. USDT/INR: Ask 88.0 (Buy USDT paying 88 INR) -> 1 INR yields 1/88 USDT
    # 2. BTC/USDT: Ask 65,000 (Buy BTC paying 65,000 USDT) -> 1 USDT yields 1/65000 BTC
    # 3. BTC/INR: Bid 5,800,000 (Sell BTC receiving 5,800,000 INR) -> 1 BTC yields 5,800,000 INR
    # Gross factor = (1/88) * (1/65000) * 5,800,000 = 5,800,000 / 5,720,000 = 1.01398 (+139.8 bps)
    # Fee is 5 bps per leg (0.0005) -> (0.9995)^3 = 0.9985
    # Net multiplier = 1.01398 * 0.9985 = 1.01246 (+124.6 bps >> 15 bps)
    quotes = [
        CurrencyPairQuote(base="USDT", quote="INR", bid=87.8, ask=88.0, fee_rate=0.0005),
        CurrencyPairQuote(base="BTC", quote="USDT", bid=64950.0, ask=65000.0, fee_rate=0.0005),
        CurrencyPairQuote(base="BTC", quote="INR", bid=5800000.0, ask=5810000.0, fee_rate=0.0005),
    ]

    rep = sieve.evaluate_triangle(c1="INR", c2="USDT", c3="BTC", quotes=quotes)

    assert rep.is_arbitrage_viable is True
    assert rep.net_profit_bps >= 15.0
    assert rep.regime == "TRIANGULAR_ARBITRAGE_DISLOCATED"
    assert rep.trade_directive == "EXECUTE_3_LEG_SYNTHETIC_ARBITRAGE"


def test_triangular_arbitrage_equilibrium(sieve):
    # Efficient cross rates where buying and selling incurs spread + fee loss
    quotes = [
        CurrencyPairQuote(base="USDT", quote="INR", bid=88.0, ask=88.05, fee_rate=0.001),
        CurrencyPairQuote(base="BTC", quote="USDT", bid=65000.0, ask=65050.0, fee_rate=0.001),
        CurrencyPairQuote(base="BTC", quote="INR", bid=5720000.0, ask=5730000.0, fee_rate=0.001),
    ]

    rep = sieve.evaluate_triangle(c1="INR", c2="USDT", c3="BTC", quotes=quotes)

    assert rep.is_arbitrage_viable is False
    assert rep.net_profit_bps < 0.0
    assert rep.regime == "TRIANGULAR_CROSS_RATE_EQUILIBRIUM"
    assert rep.trade_directive == "NO_ARBITRAGE_FOUND"


def test_sqlite_persistence(sieve):
    quotes = [
        CurrencyPairQuote(base="B", quote="A", bid=10.0, ask=10.1),
        CurrencyPairQuote(base="C", quote="B", bid=2.0, ask=2.1),
        CurrencyPairQuote(base="C", quote="A", bid=20.0, ask=20.2),
    ]
    sieve.evaluate_triangle("A", "B", "C", quotes)

    conn = sieve._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT cycle_path, gross_mult, regime FROM triangular_arb_telemetry")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "A->B->C->A"
