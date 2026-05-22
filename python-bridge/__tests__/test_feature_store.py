"""
python-bridge/__tests__/test_feature_store.py — Unit Tests for FeatureStore & R32 Vector
"""

import sys
import os
import pytest
import numpy as np

# Add python-bridge directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.feature_store import FeatureStore, FEATURE_NAMES_32, feature_store


def test_feature_names_length():
    """Verify exact 32 features are defined."""
    assert len(FEATURE_NAMES_32) == 32
    assert "ret_5m" in FEATURE_NAMES_32
    assert "cleantrend_er" in FEATURE_NAMES_32
    assert "obi_l1_l5" in FEATURE_NAMES_32
    assert "put_wall_dist_pct" in FEATURE_NAMES_32


def test_feature_vector_zero_nan_guarantee():
    """Verify that vector output has no NaNs, Infs, and strictly float32."""
    store = FeatureStore(cache_ttl_seconds=1)
    vec = store.get_feature_vector_32("RELIANCE", current_price=2900.0)

    assert isinstance(vec, np.ndarray)
    assert vec.shape == (32,)
    assert vec.dtype == np.float32
    assert not np.isnan(vec).any(), "Found NaN in feature vector!"
    assert not np.isinf(vec).any(), "Found Inf in feature vector!"


def test_feature_vector_with_extreme_values():
    """Verify robustness under extreme market volatility / corrupt data inputs."""
    store = FeatureStore()
    extreme_ctx = {
        "india_vix": 99.0,
        "vix_delta_pct": 500.0,
        "nifty_trend": 10.0,
        "sector_rs": 50.0,
        "sector_breadth": 999.0,
        "fii_long_short_ratio": -100.0,
        "gex_s0": 0.0,
        "net_gex": -99999.0,
    }
    vec = store.get_feature_vector_32("NIFTY", current_price=25000.0, market_context=extreme_ctx)

    assert not np.isnan(vec).any()
    assert not np.isinf(vec).any()
    # Check that clipped features stay within sane bounds
    assert np.all(vec >= -15.0)
    assert np.all(vec <= 15.0)


def test_bar_updates_and_ring_buffers():
    """Test pushing OHLCV bars into circular ring buffer updates indicator calculations."""
    store = FeatureStore()
    sym = "TATAMOTORS"

    # Push 20 synthetic bars with upward trend
    for i in range(25):
        p = 900.0 + i * 2.0
        store.update_bar(
            symbol=sym,
            timeframe="5m",
            o=p - 1.0,
            h=p + 3.0,
            l=p - 2.0,
            c=p + 1.0,
            v=10000.0 + i * 500.0,
            timestamp=1000.0 + i * 300.0,
        )

    vec = store.get_feature_vector_32(sym, current_price=955.0)
    f_dict = store.get_feature_dict(sym, current_price=955.0)

    # CleanTrend ER should be high since price moved straight up
    assert f_dict["cleantrend_er"] > 0.50
    # RSI on 5m should be in upper range (> 0.0 centered)
    assert f_dict["rsi_14_5m"] > 0.0


def test_legacy_backward_compatibility():
    """Verify that legacy get_features() returns expected schema for existing services."""
    store = FeatureStore()
    res = store.get_features("INFY", current_price=1800.0)

    assert "symbol" in res
    assert "ltp" in res
    assert "vwap_dev_pct" in res
    assert "rsi_14" in res
    assert "vol_ratio" in res
    assert "spread_bps" in res
    assert "feature_vector_32" in res
    assert len(res["feature_vector_32"]) == 32


def test_duckdb_baseline_integration(tmp_path):
    """Verify DuckDB baseline queries work when parquet files exist."""
    import duckdb
    store = FeatureStore()

    # Create dummy parquet
    parquet_path = tmp_path / "features_5minute.parquet"
    con = duckdb.connect(database=":memory:")
    con.execute(f"CREATE TABLE t AS SELECT 'RELIANCE' as symbol, 10000.0 as volume, 25.0 as high, 15.0 as low")
    con.execute(f"COPY t TO '{str(parquet_path).replace(chr(92), '/')}' (FORMAT PARQUET)")
    con.close()

    success = store.load_duckdb_baselines("RELIANCE", data_dir=str(tmp_path))
    assert success is True
    assert store._baseline_cache["RELIANCE"]["atr_20"] == 10.0

