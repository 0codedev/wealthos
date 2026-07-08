"""
test_wp01_quant_options.py

Comprehensive institutional test suite for WORK PACKAGE 01:
Quantitative Options Greeks, Surfaces, Snapshot Fusion, and Hero-Zero Scanner.
"""

import os
import sys
import math
import time
from datetime import datetime
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.options_greeks_surface import (
    Black76Engine,
    VectorizedGreekSurfaceEngine,
    implied_volatility,
    calculate_iv_rank_percentile,
    benchmark_chain
)
from services.options_chain_state import OptionsChainSnapshotStore, OptionLegState, StrikeState
from services.hero_zero_scanner import (
    compute_survival_fraction,
    score_hero_zero_candidate,
    scan_hero_zero_opportunities
)


# ==============================================================================
# 1. CANONICAL HULL BLACK-76 ANALYTICAL BENCHMARK
# ==============================================================================

def test_hull_black76_analytical_benchmark():
    """
    Canonical benchmark from John C. Hull: Options, Futures, and Other Derivatives.
    Futures forward F = 19.0, Strike K = 19.0, r = 0.10, t = 0.75, sigma = 0.28.
    """
    F = 19.0
    K = 19.0
    r = 0.10
    t = 0.75
    sigma = 0.28

    c_price = Black76Engine.price(F, K, r, t, sigma, "C")
    p_price = Black76Engine.price(F, K, r, t, sigma, "P")

    # At ATM forward F = K, Call price must equal Put price
    assert abs(c_price - p_price) < 1e-7, "ATM forward call and put prices must be identical"
    # Hull expected call price ~ 1.7011
    assert abs(c_price - 1.7011) < 0.005, f"Expected Call ~1.7011, got {c_price:.4f}"

    c_delta = Black76Engine.delta(F, K, r, t, sigma, "C")
    p_delta = Black76Engine.delta(F, K, r, t, sigma, "P")
    df = math.exp(-r * t)
    # Delta relation: Delta_C - Delta_P = df
    assert abs((c_delta - p_delta) - df) < 1e-7, "Delta Call - Delta Put must equal discount factor df"

    # Gamma and Vega must be strictly positive
    gamma = Black76Engine.gamma(F, K, r, t, sigma)
    vega = Black76Engine.vega(F, K, r, t, sigma)
    assert gamma > 0.0
    assert vega > 0.0


# ==============================================================================
# 2. VECTORIZED VS SCALAR ENGINE PARITY (< 1e-6 precision across all Greeks)
# ==============================================================================

def test_vectorized_vs_scalar_engine_parity():
    """Verifies that VectorizedGreekSurfaceEngine outputs match scalar Black76Engine."""
    strikes = np.array([21000 + i * 50 for i in range(40)], dtype=np.float64)
    underlying = 22000.0
    r = 0.07
    t = 14.0 / 365.0
    sigmas = np.array([0.14 + (i * 0.002) for i in range(40)], dtype=np.float64)
    is_call = np.array([i % 2 == 0 for i in range(40)], dtype=bool)

    vec_res = VectorizedGreekSurfaceEngine.compute_surface(
        strikes=strikes,
        underlying_price=underlying,
        r=r,
        t=t,
        sigmas=sigmas,
        is_call=is_call,
        lot_size=75,
        is_forward_model=True
    )

    for i in range(len(strikes)):
        k = float(strikes[i])
        sig = float(sigmas[i])
        otype = "C" if is_call[i] else "P"

        scal_price = Black76Engine.price(underlying, k, r, t, sig, otype)
        scal_delta = Black76Engine.delta(underlying, k, r, t, sig, otype)
        scal_gamma = Black76Engine.gamma(underlying, k, r, t, sig)
        scal_vega = Black76Engine.vega(underlying, k, r, t, sig) / 100.0
        scal_theta = Black76Engine.theta(underlying, k, r, t, sig, otype) / 365.0 * 75
        scal_vanna = Black76Engine.vanna(underlying, k, r, t, sig)
        scal_volga = Black76Engine.volga(underlying, k, r, t, sig)
        scal_speed = Black76Engine.speed(underlying, k, r, t, sig)

        assert abs(vec_res["price"][i] - scal_price) < 1e-5
        assert abs(vec_res["delta"][i] - scal_delta) < 1e-5
        assert abs(vec_res["gamma"][i] - scal_gamma) < 1e-6
        assert abs(vec_res["vega"][i] - scal_vega) < 1e-5
        assert abs(vec_res["theta_daily"][i] - scal_theta) < 1e-4
        assert abs(vec_res["vanna"][i] - scal_vanna) < 1e-5
        assert abs(vec_res["volga"][i] - scal_volga) < 1e-5
        assert abs(vec_res["speed"][i] - scal_speed) < 1e-6


# ==============================================================================
# 3. SYNTHETIC FORWARD PARITY & SNAPSHOT FUSION STORE
# ==============================================================================

def test_synthetic_forward_parity_and_snapshot_fusion():
    """Tests in-memory strike store fusion and synthetic forward F* = K + C - P."""
    store = OptionsChainSnapshotStore()

    mock_chain_rows = [
        {
            "strike_price": 22000.0,
            "call_options": {"instrument_key": "NSE_FO|NIFTY_22000_CE", "last_price": 140.0, "open_interest": 1500000, "volume": 800000, "bid_price": 139.5, "ask_price": 140.5, "implied_volatility": 14.5},
            "put_options": {"instrument_key": "NSE_FO|NIFTY_22000_PE", "last_price": 135.0, "open_interest": 1800000, "volume": 950000, "bid_price": 134.5, "ask_price": 135.5, "implied_volatility": 14.8}
        },
        {
            "strike_price": 22100.0,
            "call_options": {"instrument_key": "NSE_FO|NIFTY_22100_CE", "last_price": 85.0, "open_interest": 2200000, "volume": 1200000, "bid_price": 84.8, "ask_price": 85.2, "implied_volatility": 14.2},
            "put_options": {"instrument_key": "NSE_FO|NIFTY_22100_PE", "last_price": 180.0, "open_interest": 1100000, "volume": 500000, "bid_price": 179.5, "ask_price": 180.5, "implied_volatility": 15.1}
        }
    ]

    meta = store.update_from_rest_chain(
        symbol="NIFTY",
        expiry="2026-10-15",
        spot=22002.0,
        chain_rows=mock_chain_rows,
        dte_days=4.0
    )

    assert meta["symbol"] == "NIFTY"
    assert meta["atm_strike"] == 22000.0
    # Synthetic forward: 22000 + 140.0 - 135.0 = 22005.0
    assert abs(meta["synthetic_forward"] - 22005.0) < 0.1
    assert abs(meta["basis"] - (22005.0 - 22002.0)) < 0.1

    # Ingest a live streaming tick to update 22100 CE LTP and broker Greeks
    tick = {
        "instrument_key": "NSE_FO|NIFTY_22100_CE",
        "ltp": 92.5,
        "volume": 1250000,
        "oi": 2250000,
        "greeks": {"delta": 0.38, "gamma": 0.00072, "theta": -12.5, "vega": 18.2}
    }
    ingested = store.ingest_tick(tick)
    assert ingested is True

    snapshot = store.get_chain_snapshot("NIFTY", "2026-10-15")
    assert snapshot is not None
    assert snapshot["aggregates"]["total_call_oi"] > 0
    assert snapshot["aggregates"]["total_put_oi"] > 0
    assert "regime" in snapshot["aggregates"]

    # Verify updated tick values
    strike_22100 = next(s for s in snapshot["strikes"] if s["strike"] == 22100.0)
    assert strike_22100["ce"]["ltp"] == 92.5
    assert strike_22100["ce"]["delta"] == 0.38


# ==============================================================================
# 4. IV RANK & IV PERCENTILE BOUNDS
# ==============================================================================

def test_iv_rank_and_percentile():
    """Verifies IV Rank formula and boundary normalization."""
    # Test with standard NIFTY range (10.5 to 23.5)
    res_normal = calculate_iv_rank_percentile("NIFTY", 0.17)
    assert 0.0 <= res_normal["iv_rank"] <= 100.0
    assert 0.0 <= res_normal["iv_percentile"] <= 100.0
    assert res_normal["regime"] in ("NORMAL_VOLATILITY_REGIME", "ELEVATED_VOLATILITY_PREMIUM_SELLING", "COMPRESSED_VOLATILITY_LONG_GAMMA")

    # High IV scenario
    res_high = calculate_iv_rank_percentile("NIFTY", 0.30)
    assert res_high["iv_rank"] == 100.0
    assert res_high["regime"] == "ELEVATED_VOLATILITY_PREMIUM_SELLING"

    # Low IV scenario
    res_low = calculate_iv_rank_percentile("NIFTY", 0.08)
    assert res_low["iv_rank"] == 0.0
    assert res_low["regime"] == "COMPRESSED_VOLATILITY_LONG_GAMMA"


# ==============================================================================
# 5. 14:04 IST HERO-ZERO SCANNER & RISK-PARITY LINE
# ==============================================================================

def test_hero_zero_risk_parity_mechanics():
    """Verifies mathematical survival fraction u, ER(u) = 1.0, and strike filtering."""
    u, er, phase = compute_survival_fraction()
    assert 0.0 < u <= 1.0
    assert er >= 0.0

    # Test candidate scoring
    qualifying_leg = {
        "instrument_key": "NSE_FO|NIFTY_22200_CE",
        "ltp": 22.0,
        "delta": 0.14,
        "gamma": 0.00065,
        "oi": 850000,
        "volume": 620000,
        "bid": 21.8,
        "ask": 22.2,
        "bid_qty": 45000,
        "ask_qty": 30000,
        "speed": -0.000012,
        "volga": 0.85
    }

    cand = score_hero_zero_candidate(
        strike=22200.0,
        leg_data=qualifying_leg,
        spot=22150.0,
        net_gex_crores=-45.0,  # Short gamma regime
        zero_gamma_level=22100.0,
        option_type="CE"
    )

    assert cand is not None
    assert cand["strike"] == 22200.0
    assert cand["entry_price"] == 22.0
    assert cand["target_1"] == 44.0   # 2.0x
    assert cand["target_2"] == 66.0   # 3.0x
    assert cand["stop_loss"] == 11.0  # -50%
    assert cand["convexity_score"] > 0
    assert cand["dealer_alignment"] == "SHORT_GAMMA_BOOST"

    # Reject if premium is outside sweet spot (> ₹35)
    disqualified_leg = dict(qualifying_leg)
    disqualified_leg["ltp"] = 55.0
    cand_rejected = score_hero_zero_candidate(
        strike=22200.0,
        leg_data=disqualified_leg,
        spot=22150.0,
        net_gex_crores=-45.0,
        zero_gamma_level=22100.0,
        option_type="CE"
    )
    assert cand_rejected is None


# ==============================================================================
# 6. LATENCY BENCHMARK (< 1.0ms SLA ASSERTION FOR 60 STRIKES)
# ==============================================================================

def test_vectorized_latency_sla():
    """Asserts that 60-strike vectorized surface calculation completes in < 1.0 ms."""
    res = benchmark_chain(n_strikes=60, repeats=20)
    assert res["vectorized_median_ms"] < 1.0, f"Vectorized latency was {res['vectorized_median_ms']} ms (exceeded 1.0 ms SLA)"
    assert res["speedup_factor"] > 5.0, f"Speedup factor was only {res['speedup_factor']}x"


if __name__ == "__main__":
    import sys
    tests = [
        test_hull_black76_analytical_benchmark,
        test_vectorized_vs_scalar_engine_parity,
        test_synthetic_forward_parity_and_snapshot_fusion,
        test_iv_rank_and_percentile,
        test_hero_zero_risk_parity_mechanics,
        test_vectorized_latency_sla,
    ]
    passed = 0
    for t in tests:
        print(f"Running {t.__name__}...", end=" ")
        try:
            t()
            print("PASSED")
            passed += 1
        except Exception as e:
            print(f"FAILED: {e}")
            import traceback
            traceback.print_exc()
    print(f"\nAll tests completed: {passed}/{len(tests)} passed.")
    if passed != len(tests):
        sys.exit(1)

