"""Pure numpy/pandas reference computations for model-based property tests.

These functions are the *ground truth* against which the strategy
implementations' internal indicator math is compared by the model-based
properties in design.md:

* Property 17 - true VWAP            -> :func:`true_vwap`
* Property 18 - synthetic VWAP       -> :func:`synthetic_vwap`
* Property 20 - EMA recurrence       -> :func:`ema_series` / :func:`ema_last`
* Property 27 - rolling mean/std/z   -> :func:`rolling_mean`, :func:`rolling_std`, :func:`zscore`
* Property 30 - Bollinger / Keltner  -> :func:`bollinger_bands`, :func:`keltner_channels`

Design alignment (kept deliberately explicit so the references match the
strategy implementations exactly):

* ``Typical_Price = (high + low + close) / 3``.
* **True VWAP** = ``sum(typical_price * volume) / sum(volume)``.
* **Synthetic VWAP** = running mean of ``Typical_Price`` (used when volume is absent).
* **EMA recurrence**: ``ema_t = alpha * close_t + (1 - alpha) * ema_{t-1}`` with
  ``alpha = 2 / (period + 1)``, seeded with the first close. This is identical
  to ``pandas.Series.ewm(span=period, adjust=False).mean()``.
* **Rolling mean / std**: numpy with **population** std (``ddof=0``) to match the
  strategies.
* **Z-score**: ``(close - mean) / std`` over the lookback window.
* **Bollinger Bands**: ``mean ± bb_std * std`` (``ddof=0``).
* **Keltner Channels**: ``ema(close, lookback) ± kc_multiplier * ATR`` where
  ``ATR`` is the mean of True Range over the lookback window and
  ``TR = max(high - low, abs(high - prev_close), abs(low - prev_close))`` with the
  first bar's ``TR = high - low``.

The suite under test depends only on the standard library, numpy, and pandas;
these references stay within numpy/pandas as well.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np
import pandas as pd

ArrayLike = Sequence[float]


# ---------------------------------------------------------------------------
# Typical price
# ---------------------------------------------------------------------------
def typical_price(
    highs: ArrayLike, lows: ArrayLike, closes: ArrayLike
) -> np.ndarray:
    """Elementwise ``(high + low + close) / 3``."""
    h = np.asarray(highs, dtype=float)
    l = np.asarray(lows, dtype=float)
    c = np.asarray(closes, dtype=float)
    return (h + l + c) / 3.0


# ---------------------------------------------------------------------------
# VWAP (Property 17 / 18)
# ---------------------------------------------------------------------------
def true_vwap(
    highs: ArrayLike, lows: ArrayLike, closes: ArrayLike, volumes: ArrayLike
) -> float:
    """Volume-weighted average of typical price over the whole series.

    ``sum(typical_price_i * volume_i) / sum(volume_i)``.
    """
    tp = typical_price(highs, lows, closes)
    v = np.asarray(volumes, dtype=float)
    total_vol = float(np.sum(v))
    if total_vol == 0.0:
        raise ValueError("true_vwap is undefined when total volume is zero")
    return float(np.sum(tp * v) / total_vol)


def synthetic_vwap(
    highs: ArrayLike, lows: ArrayLike, closes: ArrayLike
) -> float:
    """Running mean of typical price (the volume-absent VWAP approximation)."""
    tp = typical_price(highs, lows, closes)
    if tp.size == 0:
        raise ValueError("synthetic_vwap requires at least one candle")
    return float(np.mean(tp))


def synthetic_vwap_series(
    highs: ArrayLike, lows: ArrayLike, closes: ArrayLike
) -> np.ndarray:
    """Cumulative running mean of typical price, one value per candle."""
    tp = typical_price(highs, lows, closes)
    return np.cumsum(tp) / np.arange(1, tp.size + 1)


# ---------------------------------------------------------------------------
# EMA recurrence (Property 20)
# ---------------------------------------------------------------------------
def ema_series(closes: ArrayLike, period: int) -> np.ndarray:
    """EMA series via ``ema_t = alpha*close + (1-alpha)*ema_{t-1}``.

    ``alpha = 2 / (period + 1)``; seeded with the first close. Identical to
    ``pandas.Series(closes).ewm(span=period, adjust=False).mean()``.
    """
    if period < 1:
        raise ValueError("period must be >= 1")
    c = np.asarray(closes, dtype=float)
    if c.size == 0:
        return c
    alpha = 2.0 / (period + 1.0)
    out = np.empty_like(c)
    out[0] = c[0]
    for i in range(1, c.size):
        out[i] = alpha * c[i] + (1.0 - alpha) * out[i - 1]
    return out


def ema_last(closes: ArrayLike, period: int) -> float:
    """Final EMA value of the recurrence (matches pandas ewm adjust=False)."""
    series = ema_series(closes, period)
    if series.size == 0:
        raise ValueError("ema_last requires at least one close")
    return float(series[-1])


def ema_last_pandas(closes: ArrayLike, period: int) -> float:
    """Same as :func:`ema_last` but computed via pandas (cross-check helper)."""
    s = pd.Series(np.asarray(closes, dtype=float))
    return float(s.ewm(span=period, adjust=False).mean().iloc[-1])


# ---------------------------------------------------------------------------
# Rolling statistics & z-score (Property 27)
# ---------------------------------------------------------------------------
def _last_window(values: ArrayLike, lookback: int) -> np.ndarray:
    v = np.asarray(values, dtype=float)
    if lookback < 1:
        raise ValueError("lookback must be >= 1")
    if v.size == 0:
        raise ValueError("rolling stats require at least one value")
    return v[-lookback:]


def rolling_mean(values: ArrayLike, lookback: int) -> float:
    """Mean of the last ``lookback`` values (all available if fewer)."""
    return float(np.mean(_last_window(values, lookback)))


def rolling_std(values: ArrayLike, lookback: int, ddof: int = 0) -> float:
    """Population (``ddof=0``) std of the last ``lookback`` values."""
    return float(np.std(_last_window(values, lookback), ddof=ddof))


def zscore(values: ArrayLike, lookback: int) -> float:
    """``(close - rolling_mean) / rolling_std`` over the lookback window.

    Raises ``ZeroDivisionError`` when the rolling std is zero (the strategy
    treats this as non-computable and emits nothing - design Property 29).
    """
    window = _last_window(values, lookback)
    mean = float(np.mean(window))
    std = float(np.std(window, ddof=0))
    if std == 0.0:
        raise ZeroDivisionError("z-score is non-computable when rolling std is zero")
    return (float(window[-1]) - mean) / std


# ---------------------------------------------------------------------------
# Bollinger Bands (Property 30)
# ---------------------------------------------------------------------------
def bollinger_bands(
    closes: ArrayLike, lookback: int, bb_std: float
) -> tuple[float, float, float]:
    """Return ``(lower, mid, upper)`` = ``mean -/+ bb_std * std`` (``ddof=0``)."""
    window = _last_window(closes, lookback)
    mid = float(np.mean(window))
    std = float(np.std(window, ddof=0))
    return mid - bb_std * std, mid, mid + bb_std * std


# ---------------------------------------------------------------------------
# True Range / ATR / Keltner Channels (Property 30)
# ---------------------------------------------------------------------------
def true_range(
    highs: ArrayLike, lows: ArrayLike, closes: ArrayLike
) -> np.ndarray:
    """True Range series.

    ``TR_t = max(high-low, |high-prev_close|, |low-prev_close|)`` with the first
    bar's ``TR = high - low``.
    """
    h = np.asarray(highs, dtype=float)
    l = np.asarray(lows, dtype=float)
    c = np.asarray(closes, dtype=float)
    n = h.size
    tr = np.empty(n)
    if n == 0:
        return tr
    tr[0] = h[0] - l[0]
    for i in range(1, n):
        prev_close = c[i - 1]
        tr[i] = max(
            h[i] - l[i],
            abs(h[i] - prev_close),
            abs(l[i] - prev_close),
        )
    return tr


def atr(
    highs: ArrayLike, lows: ArrayLike, closes: ArrayLike, lookback: int
) -> float:
    """Average True Range = mean of the last ``lookback`` True Range values."""
    tr = true_range(highs, lows, closes)
    if tr.size == 0:
        raise ValueError("atr requires at least one candle")
    return float(np.mean(tr[-lookback:]))


def keltner_channels(
    highs: ArrayLike,
    lows: ArrayLike,
    closes: ArrayLike,
    lookback: int,
    kc_multiplier: float,
) -> tuple[float, float, float]:
    """Return ``(lower, mid, upper)`` = ``ema(close) -/+ kc_multiplier * ATR``.

    The mid line is ``ema_last(closes, lookback)`` (pandas ``ewm`` adjust=False).
    """
    mid = ema_last(closes, lookback)
    channel = kc_multiplier * atr(highs, lows, closes, lookback)
    return mid - channel, mid, mid + channel
