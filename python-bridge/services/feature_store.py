"""
python-bridge/services/feature_store.py — Centralized Feature Store for ML Models
Work Package 08: Institutional 32-Dimensional Microstructure & MTF Feature Vector

Computes, caches, and serializes normalized features:
- ℝ³² Feature Tensor (Price Action, Volume, Microstructure/Flow, Volatility, Macro, GEX)
- In-memory circular ring buffers for tick and multi-cadence bar updates
- DuckDB Parquet baseline integration (20-day ADV & ATR)
- Zero-NaN / Zero-Inf mathematical guarantees with strict winsorization
"""

import os
import time
import math
import logging
from collections import deque
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

log = logging.getLogger("feature_store")

# Exact 32 Feature Names matching the Master Plan
FEATURE_NAMES_32: List[str] = [
    # 1. Price Action & Momentum (f1 - f8)
    "ret_5m",
    "ret_15m",
    "vwap_zscore",
    "dist_ema20_pct",
    "cleantrend_er",
    "rsi_14_5m",
    "rsi_14_15m",
    "squeeze_ratio",
    # 2. Volume & Participation (f9 - f12)
    "rvol_5m",
    "rvol_15m",
    "adv_share",
    "candle_body_ratio",
    # 3. Microstructure & Order Flow (f13 - f18)
    "cvd_slope_3m",
    "cvd_divergence",
    "obi_l1_l5",
    "spread_bps",
    "vpin_estimate",
    "microprice_offset",
    # 4. Volatility & Risk (f19 - f22)
    "atr_pct_5m",
    "vol_garman_klass",
    "vol_parkinson",
    "vol_ratio_1h_20d",
    # 5. Macro & Regime Context (f23 - f28)
    "india_vix",
    "vix_delta_pct",
    "nifty_trend",
    "sector_rs",
    "zweig_breadth_thrust",
    "fii_derivatives_bias",
    # 6. Options & GEX Structure (f29 - f32)
    "spot_vs_s0_flip",
    "net_dealer_gex",
    "call_wall_dist_pct",
    "put_wall_dist_pct",
]


class BarRingBuffer:
    """Fixed-size circular buffer holding OHLCV bars for rapid indicator computation."""

    def __init__(self, maxlen: int = 120):
        self.maxlen = maxlen
        self.bars = deque(maxlen=maxlen)

    def append(self, o: float, h: float, l: float, c: float, v: float, ts: float):
        self.bars.append({
            "open": float(o),
            "high": float(h),
            "low": float(l),
            "close": float(c),
            "volume": float(v),
            "timestamp": float(ts),
        })

    def __len__(self) -> int:
        return len(self.bars)

    def closes(self) -> np.ndarray:
        return np.array([b["close"] for b in self.bars], dtype=np.float64)

    def highs(self) -> np.ndarray:
        return np.array([b["high"] for b in self.bars], dtype=np.float64)

    def lows(self) -> np.ndarray:
        return np.array([b["low"] for b in self.bars], dtype=np.float64)

    def opens(self) -> np.ndarray:
        return np.array([b["open"] for b in self.bars], dtype=np.float64)

    def volumes(self) -> np.ndarray:
        return np.array([b["volume"] for b in self.bars], dtype=np.float64)


class FeatureStore:
    def __init__(self, cache_ttl_seconds: int = 15):
        self.ttl = cache_ttl_seconds
        self._cache: Dict[str, Tuple[Dict[str, Any], float]] = {}
        self._cache_vec32: Dict[str, Tuple[np.ndarray, float]] = {}

        # In-memory sliding windows per symbol
        # symbol -> { '1m': BarRingBuffer, '5m': BarRingBuffer, '15m': BarRingBuffer }
        self._bar_buffers: Dict[str, Dict[str, BarRingBuffer]] = {}

        # Quote / Orderbook sliding states
        self._orderbook_state: Dict[str, Dict[str, Any]] = {}

        # Baselines cache (symbol -> { 'adv_20': float, 'atr_20': float })
        self._baseline_cache: Dict[str, Dict[str, float]] = {}

    def _ensure_buffers(self, symbol: str):
        sym = symbol.upper()
        if sym not in self._bar_buffers:
            self._bar_buffers[sym] = {
                "1m": BarRingBuffer(maxlen=120),
                "5m": BarRingBuffer(maxlen=60),
                "15m": BarRingBuffer(maxlen=40),
            }

    def update_bar(
        self,
        symbol: str,
        timeframe: str,
        o: float,
        h: float,
        l: float,
        c: float,
        v: float,
        timestamp: Optional[float] = None,
    ):
        """Pushes a completed bar into the in-memory circular ring buffer."""
        sym = symbol.upper()
        self._ensure_buffers(sym)
        tf = timeframe.lower()
        if tf in self._bar_buffers[sym]:
            ts = timestamp if timestamp is not None else time.time()
            self._bar_buffers[sym][tf].append(o, h, l, c, v, ts)
            # Invalidate cached vector for this symbol
            self._cache_vec32.pop(sym, None)
            self._cache.pop(sym, None)

    def update_quote(
        self,
        symbol: str,
        ltp: float,
        bid: float = 0.0,
        ask: float = 0.0,
        bid_qty: float = 0.0,
        ask_qty: float = 0.0,
        cvd: float = 0.0,
        timestamp: Optional[float] = None,
    ):
        """Updates instantaneous orderbook and quote state."""
        sym = symbol.upper()
        ts = timestamp if timestamp is not None else time.time()
        self._orderbook_state[sym] = {
            "ltp": float(ltp),
            "bid": float(bid if bid > 0 else ltp * 0.9998),
            "ask": float(ask if ask > 0 else ltp * 1.0002),
            "bid_qty": float(bid_qty),
            "ask_qty": float(ask_qty),
            "cvd": float(cvd),
            "timestamp": ts,
        }
        self._cache_vec32.pop(sym, None)
        self._cache.pop(sym, None)

    def set_baselines(self, symbol: str, adv_20: float, atr_20: float):
        """Injects precomputed DuckDB/historical baselines for a symbol."""
        sym = symbol.upper()
        self._baseline_cache[sym] = {
            "adv_20": max(1.0, float(adv_20)),
            "atr_20": max(0.01, float(atr_20)),
        }

    def load_duckdb_baselines(self, symbol: str, data_dir: Optional[str] = None) -> bool:
        """
        Attempts to load 20-day ADV and ATR from local Parquet/DuckDB tables.
        Returns True if successfully populated, False if fell back to heuristic.
        """
        sym = symbol.upper()
        try:
            import duckdb
            base_dir = data_dir or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
            parquet_path = os.path.join(base_dir, "features_5minute.parquet").replace("\\", "/")
            if os.path.exists(parquet_path):
                con = duckdb.connect(database=":memory:")
                query = f"SELECT AVG(volume) as adv, AVG(high - low) as atr FROM '{parquet_path}' WHERE symbol = '{sym}'"
                row = con.execute(query).fetchone()
                con.close()
                if row and row[0] is not None and row[1] is not None:
                    self.set_baselines(sym, float(row[0]) * 75.0, float(row[1]))
                    log.info(f"[FEATURE_STORE] Loaded DuckDB baselines for {sym}: ADV={row[0]:.0f}, ATR={row[1]:.2f}")
                    return True
        except Exception as e:
            log.debug(f"[FEATURE_STORE] DuckDB baseline load skipped for {sym}: {e}")
        return False

    # ==========================================
    # Quantitative Technical Indicator Helpers
    # ==========================================

    @staticmethod
    def _calc_rsi(closes: np.ndarray, period: int = 14) -> float:
        if len(closes) < period + 1:
            return 50.0
        diffs = np.diff(closes)
        gains = np.maximum(diffs, 0.0)
        losses = np.maximum(-diffs, 0.0)
        avg_gain = np.mean(gains[:period])
        avg_loss = np.mean(losses[:period])
        for i in range(period, len(diffs)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0.0:
            return 100.0 if avg_gain > 0 else 50.0
        rs = avg_gain / avg_loss
        return float(100.0 - (100.0 / (1.0 + rs)))

    @staticmethod
    def _calc_kaufman_er(closes: np.ndarray, period: int = 10) -> float:
        """Kaufman Efficiency Ratio (CleanTrend ER) = Total Directional Move / Path Length."""
        if len(closes) < period + 1:
            return 0.50
        net_change = abs(closes[-1] - closes[-period - 1])
        volatility = np.sum(np.abs(np.diff(closes[-period - 1 :])))
        if volatility <= 1e-6:
            return 1.0 if net_change > 0 else 0.0
        return float(np.clip(net_change / volatility, 0.0, 1.0))

    @staticmethod
    def _calc_garman_klass(opens: np.ndarray, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray) -> float:
        if len(closes) < 5:
            return 0.15
        h, l, c, o = highs[-10:], lows[-10:], closes[-10:], opens[-10:]
        # Guard against zero/negative prices
        o = np.maximum(o, 1e-4)
        c = np.maximum(c, 1e-4)
        h = np.maximum(h, 1e-4)
        l = np.maximum(l, 1e-4)
        log_hl = np.log(h / l)
        log_co = np.log(c / o)
        term1 = 0.5 * (log_hl ** 2)
        term2 = (2.0 * math.log(2.0) - 1.0) * (log_co ** 2)
        gk = np.sqrt(np.maximum(0.0, np.mean(term1 - term2))) * math.sqrt(252.0 * 75.0)  # Intraday 5m annualized
        return float(np.clip(gk, 0.01, 2.0))

    @staticmethod
    def _calc_parkinson(highs: np.ndarray, lows: np.ndarray) -> float:
        if len(highs) < 5:
            return 0.15
        h = np.maximum(highs[-10:], 1e-4)
        l = np.maximum(lows[-10:], 1e-4)
        log_hl = np.log(h / l)
        park = np.sqrt(np.mean(log_hl ** 2) / (4.0 * math.log(2.0))) * math.sqrt(252.0 * 75.0)
        return float(np.clip(park, 0.01, 2.0))

    # ==========================================
    # 32-Dimensional Feature Vector Extractor
    # ==========================================

    def get_feature_vector_32(
        self,
        symbol: str,
        current_price: float = 100.0,
        market_context: Optional[Dict[str, Any]] = None,
    ) -> np.ndarray:
        """
        Generates the normalized float32[32] feature vector.
        Guaranteed: Zero NaN, zero Inf, all values strictly bounded.
        """
        sym = symbol.upper()
        now = time.time()

        # Check vector cache
        if sym in self._cache_vec32:
            vec, ts = self._cache_vec32[sym]
            if now - ts < self.ttl:
                return vec

        self._ensure_buffers(sym)
        ctx = market_context or {}
        buf5m = self._bar_buffers[sym]["5m"]
        buf15m = self._bar_buffers[sym]["15m"]
        ob = self._orderbook_state.get(sym, {})
        base = self._baseline_cache.get(sym, {"adv_20": 500000.0, "atr_20": max(0.5, current_price * 0.015)})

        ltp = float(current_price if current_price > 0 else ob.get("ltp", 100.0))
        closes5 = buf5m.closes()
        highs5 = buf5m.highs()
        lows5 = buf5m.lows()
        opens5 = buf5m.opens()
        vols5 = buf5m.volumes()
        closes15 = buf15m.closes()

        # 1. ret_5m
        ret_5m = float((ltp - closes5[-1]) / closes5[-1]) if len(closes5) >= 1 and closes5[-1] > 0 else 0.0
        ret_5m = np.clip(ret_5m, -0.15, 0.15)

        # 2. ret_15m
        ret_15m = float((ltp - closes15[-1]) / closes15[-1]) if len(closes15) >= 1 and closes15[-1] > 0 else ret_5m
        ret_15m = np.clip(ret_15m, -0.25, 0.25)

        # 3. vwap_zscore
        vwap = float(ctx.get("vwap", ltp))
        vwap_dev = (ltp - vwap) / max(vwap * 0.005, 0.01)
        vwap_zscore = float(np.clip(vwap_dev, -4.0, 4.0))

        # 4. dist_ema20_pct
        if len(closes5) >= 20:
            ema20 = float(np.mean(closes5[-20:]))  # Proxy
            dist_ema20_pct = (ltp - ema20) / ema20 * 100.0
        else:
            dist_ema20_pct = ret_5m * 100.0
        dist_ema20_pct = float(np.clip(dist_ema20_pct, -10.0, 10.0))

        # 5. cleantrend_er
        cleantrend_er = self._calc_kaufman_er(closes5, period=10) if len(closes5) >= 11 else 0.50

        # 6. rsi_14_5m
        rsi_14_5m = (self._calc_rsi(closes5, 14) - 50.0) / 50.0  # Center around 0.0 [-1.0, 1.0]

        # 7. rsi_14_15m
        rsi_14_15m = (self._calc_rsi(closes15, 14) - 50.0) / 50.0

        # 8. squeeze_ratio (Bollinger Width / Keltner Width)
        if len(closes5) >= 20:
            bb_std = np.std(closes5[-20:])
            kc_atr = np.mean(highs5[-20:] - lows5[-20:])
            squeeze_ratio = float(bb_std / max(kc_atr, 1e-4))
        else:
            squeeze_ratio = 0.85
        squeeze_ratio = float(np.clip(squeeze_ratio, 0.1, 3.0))

        # 9. rvol_5m
        rvol_5m = float(vols5[-1] / max(np.mean(vols5[-10:]), 1.0)) if len(vols5) >= 2 else 1.0
        rvol_5m = float(np.clip(rvol_5m, 0.0, 10.0))

        # 10. rvol_15m
        vols15 = buf15m.volumes()
        rvol_15m = float(vols15[-1] / max(np.mean(vols15[-5:]), 1.0)) if len(vols15) >= 2 else rvol_5m
        rvol_15m = float(np.clip(rvol_15m, 0.0, 10.0))

        # 11. adv_share
        cum_vol = float(ctx.get("cum_volume", np.sum(vols5) if len(vols5) > 0 else 50000.0))
        adv_share = float(np.clip(cum_vol / base["adv_20"], 0.0, 5.0))

        # 12. candle_body_ratio
        if len(closes5) >= 1:
            body = abs(closes5[-1] - opens5[-1])
            candle_range = highs5[-1] - lows5[-1]
            candle_body_ratio = float(body / max(candle_range, 1e-4))
        else:
            candle_body_ratio = 0.50
        candle_body_ratio = float(np.clip(candle_body_ratio, 0.0, 1.0))

        # 13. cvd_slope_3m
        cvd = float(ob.get("cvd", ctx.get("cvd", 0.0)))
        cvd_slope_3m = float(np.clip(cvd / 10000.0, -5.0, 5.0))

        # 14. cvd_divergence (sign match between price return and cvd)
        cvd_divergence = 1.0 if (ret_5m * cvd_slope_3m >= 0) else -1.0

        # 15. obi_l1_l5 (Order Book Imbalance)
        b_qty = float(ob.get("bid_qty", 500.0))
        a_qty = float(ob.get("ask_qty", 500.0))
        tot_qty = b_qty + a_qty
        obi_l1_l5 = float((b_qty - a_qty) / tot_qty) if tot_qty > 0 else 0.0
        obi_l1_l5 = float(np.clip(obi_l1_l5, -1.0, 1.0))

        # 16. spread_bps
        bid = float(ob.get("bid", ltp * 0.9998))
        ask = float(ob.get("ask", ltp * 1.0002))
        mid = (bid + ask) * 0.5 if (bid + ask) > 0 else ltp
        spread_bps = float(((ask - bid) / mid) * 10000.0) if mid > 0 else 2.0
        spread_bps = float(np.clip(spread_bps, 0.1, 50.0))

        # 17. vpin_estimate
        vpin_estimate = float(np.clip(abs(obi_l1_l5) * 0.5 + abs(ret_5m) * 5.0, 0.0, 1.0))

        # 18. microprice_offset
        if tot_qty > 0:
            micro_price = (bid * a_qty + ask * b_qty) / tot_qty
            microprice_offset = float((micro_price - mid) / max(mid * 0.001, 1e-4))
        else:
            microprice_offset = 0.0
        microprice_offset = float(np.clip(microprice_offset, -3.0, 3.0))

        # 19. atr_pct_5m
        if len(highs5) >= 14:
            tr = np.maximum(highs5[-14:] - lows5[-14:], abs(highs5[-14:] - closes5[-15:-1]))
            atr_5m = float(np.mean(tr))
        else:
            atr_5m = base["atr_20"]
        atr_pct_5m = float(np.clip((atr_5m / ltp) * 100.0, 0.05, 10.0))

        # 20. vol_garman_klass
        vol_garman_klass = self._calc_garman_klass(opens5, highs5, lows5, closes5)

        # 21. vol_parkinson
        vol_parkinson = self._calc_parkinson(highs5, lows5)

        # 22. vol_ratio_1h_20d
        vol_ratio_1h_20d = float(np.clip(vol_garman_klass / max(base["atr_20"] / ltp * math.sqrt(252), 0.05), 0.2, 5.0))

        # 23. india_vix (normalized to baseline 15.0)
        india_vix_raw = float(ctx.get("india_vix", 14.5))
        india_vix = float(np.clip((india_vix_raw - 15.0) / 10.0, -1.5, 3.0))

        # 24. vix_delta_pct
        vix_delta_pct = float(np.clip(ctx.get("vix_delta_pct", 0.0), -20.0, 20.0)) / 10.0

        # 25. nifty_trend (Spot vs 20 EMA: 1.0 bull, -1.0 bear, 0.0 flat)
        nifty_trend = float(np.clip(ctx.get("nifty_trend", 0.5), -1.0, 1.0))

        # 26. sector_rs (Mansfield RS centered around 1.0 -> -2.0 to 2.0)
        sector_rs_raw = float(ctx.get("sector_rs", 1.01))
        sector_rs = float(np.clip((sector_rs_raw - 1.0) * 100.0, -5.0, 5.0))

        # 27. zweig_breadth_thrust (0.0 to 1.0, centered around 0.50)
        zweig_breadth_thrust = float(np.clip((ctx.get("sector_breadth", 55.0) - 50.0) / 50.0, -1.0, 1.0))

        # 28. fii_derivatives_bias (FII Long/Short ratio centered at 1.0)
        fii_ratio = float(ctx.get("fii_long_short_ratio", 1.15))
        fii_derivatives_bias = float(np.clip((fii_ratio - 1.0), -1.0, 2.0))

        # 29. spot_vs_s0_flip (% distance to Zero-Gamma Flip)
        s0 = float(ctx.get("gex_s0", ltp * 0.995))
        spot_vs_s0_flip = float(np.clip(((ltp - s0) / max(abs(s0), 1e-4)) * 100.0, -10.0, 10.0))

        # 30. net_dealer_gex (Positive: Long Gamma, Negative: Short Gamma)
        net_gex = float(ctx.get("net_gex", 150.0))
        net_dealer_gex = float(np.clip(net_gex / 500.0, -3.0, 3.0))

        # 31. call_wall_dist_pct
        call_wall = float(ctx.get("call_wall", ltp * 1.02))
        call_wall_dist_pct = float(np.clip(((call_wall - ltp) / max(abs(ltp), 1e-4)) * 100.0, -5.0, 15.0))

        # 32. put_wall_dist_pct
        put_wall = float(ctx.get("put_wall", ltp * 0.98))
        put_wall_dist_pct = float(np.clip(((ltp - put_wall) / max(abs(ltp), 1e-4)) * 100.0, -5.0, 15.0))

        # Assemble into NumPy array with strictly float32
        vector = np.array([
            ret_5m,
            ret_15m,
            vwap_zscore,
            dist_ema20_pct,
            cleantrend_er,
            rsi_14_5m,
            rsi_14_15m,
            squeeze_ratio,
            rvol_5m,
            rvol_15m,
            adv_share,
            candle_body_ratio,
            cvd_slope_3m,
            cvd_divergence,
            obi_l1_l5,
            spread_bps,
            vpin_estimate,
            microprice_offset,
            atr_pct_5m,
            vol_garman_klass,
            vol_parkinson,
            vol_ratio_1h_20d,
            india_vix,
            vix_delta_pct,
            nifty_trend,
            sector_rs,
            zweig_breadth_thrust,
            fii_derivatives_bias,
            spot_vs_s0_flip,
            net_dealer_gex,
            call_wall_dist_pct,
            put_wall_dist_pct,
        ], dtype=np.float32)

        # Zero-NaN / Zero-Inf Invariant Check
        np.nan_to_num(vector, copy=False, nan=0.0, posinf=1.0, neginf=-1.0)

        # Store in vector cache
        self._cache_vec32[sym] = (vector, now)
        return vector

    def get_feature_dict(
        self,
        symbol: str,
        current_price: float = 100.0,
        market_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, float]:
        """Returns 32 features as an interpretable key-value dictionary."""
        vec = self.get_feature_vector_32(symbol, current_price, market_context)
        return {name: float(val) for name, val in zip(FEATURE_NAMES_32, vec)}

    def get_features(self, symbol: str, current_price: float = 100.0) -> Dict[str, Any]:
        """
        Backward-compatible legacy signature for existing python-bridge callers.
        """
        now = time.time()
        sym = symbol.upper()
        if sym in self._cache:
            data, ts = self._cache[sym]
            if now - ts < self.ttl:
                return data

        vec_dict = self.get_feature_dict(sym, current_price)
        legacy_data = {
            "symbol": sym,
            "ltp": float(current_price),
            "vwap_dev_pct": float(vec_dict["vwap_zscore"] * 0.1),
            "rsi_14": float(vec_dict["rsi_14_5m"] * 50.0 + 50.0),
            "vol_ratio": float(vec_dict["rvol_5m"]),
            "spread_bps": float(vec_dict["spread_bps"]),
            "calculated_at": now,
            "feature_vector_32": [float(x) for x in self.get_feature_vector_32(sym, current_price)],
        }
        self._cache[sym] = (legacy_data, now)
        return legacy_data


# Global singleton instance
feature_store = FeatureStore()
