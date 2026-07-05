"""
Unit Tests for Intraday Trade Size Distribution Power-Law & Hidden Iceberg Sieve
Domain 232 / Work Package WP-ED
"""

import pytest
import math
import random
from services.power_law_iceberg_sieve import (
    PowerLawIcebergSieve,
    TradeTick,
    IcebergRegimeState,
)


def generate_synthetic_pareto_sizes(n: int = 100, alpha_true: float = 2.5, s_min: float = 10.0, seed: int = 42):
    random.seed(seed)
    # Inverse transform sampling: s = s_min * (1 - u)^(-1 / (alpha - 1))
    sizes = []
    exponent = -1.0 / (alpha_true - 1.0)
    for _ in range(n):
        u = random.random()
        s = s_min * ((1.0 - u) ** exponent)
        sizes.append(s)
    return sizes


def test_power_law_mle_fit():
    sieve = PowerLawIcebergSieve()
    sizes = generate_synthetic_pareto_sizes(n=200, alpha_true=2.6, s_min=10.0)

    fit = sieve.fit_power_law_tail(sizes, s_min=10.0)
    assert pytest.approx(fit.alpha_tail_index, 0.25) == 2.6
    assert fit.std_error > 0.0
    assert fit.is_heavy_tailed is True


def test_iceberg_buy_anchor_detection():
    sieve = PowerLawIcebergSieve(min_absorption_ratio=2.5, min_reloads=3)

    # Simulate hidden iceberg at bid price 100.0
    # 5 consecutive market sell orders hitting 100 shares each at 100.0 within 0.1s
    trades = []
    t = 0.0
    for i in range(5):
        t += 0.08  # sub-second reload
        trades.append(TradeTick(price=100.0, size=100.0, timestamp=t, is_buyer_maker=True))

    icebergs = sieve.detect_icebergs(trades)
    assert len(icebergs) == 1
    ice = icebergs[0]
    assert ice.price_level == 100.0
    assert ice.side == "buy"
    assert ice.total_absorbed_volume == 500.0
    assert ice.absorption_ratio == 5.0
    assert ice.reload_count >= 3


def test_iceberg_sell_ceiling_detection():
    sieve = PowerLawIcebergSieve(min_absorption_ratio=2.5, min_reloads=3)

    # Hidden seller at ask 105.0: is_buyer_maker = False (buyer takes liquidity, passive seller)
    trades = []
    t = 0.0
    for i in range(6):
        t += 0.05
        trades.append(TradeTick(price=105.0, size=50.0, timestamp=t, is_buyer_maker=False))

    decision = sieve.evaluate_order_flow_structure(trades)
    assert decision.regime == IcebergRegimeState.ICEBERG_SELL_CEILING
    assert "SELL_CEILING_DETECTED" in decision.recommended_action
    assert len(decision.active_icebergs) == 1


def test_normal_organic_power_law_flow():
    sieve = PowerLawIcebergSieve()

    # Organic diverse trades at various prices
    trades = []
    prices = [100.0, 100.2, 100.5, 99.8, 100.1, 100.3, 100.4, 99.9, 100.2, 100.6]
    for i, p in enumerate(prices):
        trades.append(TradeTick(price=p, size=float(10 * (i + 1)), timestamp=float(i * 2.0), is_buyer_maker=(i % 2 == 0)))

    decision = sieve.evaluate_order_flow_structure(trades)
    assert decision.regime == IcebergRegimeState.NORMAL_POWER_LAW
    assert len(decision.active_icebergs) == 0
    assert "ORGANIC_FLOW" in decision.recommended_action
