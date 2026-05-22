"""
python-bridge/__tests__/test_inference_latency.py — Unit Tests & Latency Benchmark for ML Inference Daemon
"""

import sys
import os
import time
import pytest
import numpy as np

# Add python-bridge directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.ml_signal_server import MLSignalServer, ml_signal_server


def test_score_signal_schema_and_types():
    """Verify that score_signal returns a complete institutional decision payload."""
    server = MLSignalServer()
    ctx = {
        "india_vix": 14.2,
        "nifty_trend": 0.5,
        "sector_breadth": 65.0,
        "vwap": 2940.0,
    }
    res = server.score_signal("RELIANCE", current_price=2950.0, market_context=ctx)

    assert "symbol" in res
    assert res["symbol"] == "RELIANCE"
    assert res["decision"] in ("FIRE", "WAIT", "ABORT")
    assert 0.0 <= res["confidence"] <= 1.0
    assert 0.0 <= res["effective_score"] <= 100.0
    assert "latency_ms" in res
    assert res["latency_ms"] >= 0.0
    assert "inference_source" in res
    assert "active_regime" in res
    assert "weights" in res
    assert "collision" in res
    assert "sub_scores" in res


def test_legacy_interface_backward_compatibility():
    """Verify legacy predict_signal_confidence and should_allow_signal signatures."""
    server = MLSignalServer()
    features = {
        "symbol": "INFY",
        "ltp": 1820.0,
        "sectorStrength": 25.0,
        "strengthFactor": 120.0,
        "niftyChange": 0.45,
    }

    conf = server.predict_signal_confidence(features)
    assert isinstance(conf, float)
    assert 0.0 <= conf <= 1.0

    allowed, conf_gate, reason = server.should_allow_signal(features)
    assert isinstance(allowed, bool)
    assert isinstance(conf_gate, float)
    assert isinstance(reason, str)


def test_sub_10ms_latency_benchmark():
    """
    Non-negotiable SLA Benchmark:
    Verifies that end-to-end scoring pipeline achieves P99 < 10ms (target median < 2ms)
    over 1,000 continuous evaluations.
    """
    server = MLSignalServer()
    symbols = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN", "BHARTIARTL", "LT"]
    latencies = []

    # Warmup
    for sym in symbols:
        server.score_signal(sym, current_price=1500.0)

    # 1,000 iterations benchmark
    total_evals = 1000
    for i in range(total_evals):
        sym = symbols[i % len(symbols)]
        p = 1000.0 + (i % 200) * 5.0
        ctx = {
            "india_vix": 13.5 + (i % 5) * 0.5,
            "trend_slope": 0.001 if i % 2 == 0 else -0.001,
            "sector_breadth": 50.0 + (i % 30),
        }

        t_start = time.perf_counter()
        server.score_signal(sym, current_price=p, market_context=ctx)
        latencies.append((time.perf_counter() - t_start) * 1000.0)

    median_lat = float(np.median(latencies))
    p95_lat = float(np.percentile(latencies, 95))
    p99_lat = float(np.percentile(latencies, 99))
    max_lat = float(np.max(latencies))

    print(f"\n[LATENCY BENCHMARK] 1,000 Runs -> Median: {median_lat:.3f}ms | P95: {p95_lat:.3f}ms | P99: {p99_lat:.3f}ms | Max: {max_lat:.3f}ms")

    # Strict SLA Assertions
    assert p99_lat < 10.0, f"P99 latency was {p99_lat:.3f}ms, exceeding 10ms SLA!"
    assert median_lat < 2.0, f"Median latency was {median_lat:.3f}ms, exceeding 2ms target!"
