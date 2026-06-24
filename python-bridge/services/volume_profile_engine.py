"""
volume_profile_engine.py — WealthOS Alpha Engine 2.0
=====================================================

Vectorized, institutional-grade Volume Profile engine for the Indian market
(NSE/BSE cash & F&O). Computes the price-volume distribution over rolling
trading-day windows and extracts the structural levels that intraday mean
reversion and BTST setups key off:

    * POC  — Point of Control (price bin with the highest traded volume)
    * VAH  — Value Area High (upper bound of the 70% volume distribution)
    * VAL  — Value Area Low  (lower bound of the 70% volume distribution)
    * HVN  — High Volume Nodes (acceptance / magnet / S-R shelves)
    * LVN  — Low Volume Nodes  (rejection / vacuum / fast-move gaps)

Design notes
------------
* Numeric kernel is 100% NumPy, float64, fully vectorized (no Python loops over
  bars). The volume of each OHLC bar is distributed *uniformly across the price
  range it traded* (the standard "range distribution" method), not lumped onto a
  single representative price. This is materially more accurate than close-only
  histogramming and is what desks actually rely on.
* Polars is used for I/O, timestamp/timezone normalization, trading-day window
  slicing and rolling aggregation — it is not used for the hot numeric kernel.
* Zero global mutable state, import-safe, and every public function fails soft:
  malformed / empty / flat / all-zero-volume inputs return a well-formed,
  numerically-safe result instead of raising.

Statutory / market conventions
------------------------------
* All timestamps are normalized to Asia/Kolkata (IST) before trading-day
  bucketing. This matters: ISO strings with a +05:30 offset parse to UTC in
  Polars, which silently shifts the calendar date back by one for bars that
  start before 05:30 UTC. We convert back to IST explicitly.
* "N-day" window means the last N *distinct trading dates* present in the data,
  not a raw 24h*N wall-clock span — so weekends/holidays never distort horizon.

Public API
----------
    compute_volume_profile(bars, window_days=5, ...) -> VolumeProfile
    compute_multi_window_profile(bars, windows=(5, 30), ...) -> MultiWindowProfile
    load_bars(path_or_frame) -> pl.DataFrame
    profile_from_parquet(path, ...) -> VolumeProfile
    multi_profile_from_parquet(path, ...) -> MultiWindowProfile
"""

from __future__ import annotations

import logging
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple, Union

import numpy as np
import polars as pl

__version__ = "1.0.0"

log = logging.getLogger("volume_profile_engine")

IST = "Asia/Kolkata"

# OHLCV column contract.
_OHLCV = ("open", "high", "low", "close", "volume")
_REQUIRED = ("timestamp", "high", "low", "close", "volume")

NodeKind = Literal["HVN", "LVN"]
NodeRole = Literal["support", "resistance", "in_value_area", "above_va", "below_va"]


# ==============================================================================
# DATA CONTRACTS
# ==============================================================================


@dataclass(frozen=True, slots=True)
class VolumeNode:
    """A structural volume node (HVN shelf or LVN vacuum)."""

    kind: NodeKind
    price: float
    lower: float
    upper: float
    volume: float
    strength: float  # 0..1, normalized prominence of the node
    bin_index: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ValueArea:
    """70% (configurable) volume distribution band."""

    poc: float
    poc_volume: float
    poc_bin: int
    val: float
    vah: float
    val_bin: int
    vah_bin: int
    captured_pct: float  # fraction of total volume actually enclosed


@dataclass(frozen=True, slots=True)
class RelativeLevels:
    """Nearest structural levels relative to a reference price (usually last close)."""

    reference_price: float
    nearest_hvn_above: Optional[float]
    nearest_hvn_below: Optional[float]
    nearest_lvn_above: Optional[float]
    nearest_lvn_below: Optional[float]
    hvn_above_dist_pct: Optional[float]
    hvn_below_dist_pct: Optional[float]
    lvn_above_dist_pct: Optional[float]
    lvn_below_dist_pct: Optional[float]
    position: NodeRole

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class VolumeProfile:
    """Complete volume profile for a single rolling window."""

    window_days: int
    n_bins: int
    price_low: float
    price_high: float
    bin_size: float
    total_volume: float
    value_area: ValueArea
    hvn: List[VolumeNode] = field(default_factory=list)
    lvn: List[VolumeNode] = field(default_factory=list)
    relative: Optional[RelativeLevels] = None
    bars_used: int = 0
    first_timestamp: Optional[str] = None
    last_timestamp: Optional[str] = None
    profile: Optional[List[float]] = None  # per-bin volume, top-level POC included
    bins: Optional[List[Dict[str, float]]] = None  # [{price, lower, upper, volume}]

    def to_dict(self) -> Dict[str, Any]:
        out = {
            "window_days": self.window_days,
            "n_bins": self.n_bins,
            "price_low": round(self.price_low, 6),
            "price_high": round(self.price_high, 6),
            "bin_size": round(self.bin_size, 6),
            "total_volume": round(self.total_volume, 4),
            "value_area": asdict(self.value_area),
            "hvn": [n.to_dict() for n in self.hvn],
            "lvn": [n.to_dict() for n in self.lvn],
            "relative": self.relative.to_dict() if self.relative else None,
            "bars_used": self.bars_used,
            "first_timestamp": self.first_timestamp,
            "last_timestamp": self.last_timestamp,
        }
        if self.bins is not None:
            out["bins"] = self.bins
        elif self.profile is not None:
            out["profile"] = [round(v, 4) for v in self.profile]
        return out


@dataclass(frozen=True, slots=True)
class MultiWindowProfile:
    """5-day vs 30-day (or any pair/set) composite volume structure."""

    profiles: Dict[int, VolumeProfile]
    short_window: int
    long_window: int
    poc_shift_pct: Optional[float]
    value_area_overlap_pct: Optional[float]
    value_area_migration: Optional[str]
    composite_signal: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "profiles": {str(k): v.to_dict() for k, v in self.profiles.items()},
            "short_window": self.short_window,
            "long_window": self.long_window,
            "poc_shift_pct": None if self.poc_shift_pct is None else round(self.poc_shift_pct, 4),
            "value_area_overlap_pct": (
                None if self.value_area_overlap_pct is None else round(self.value_area_overlap_pct, 4)
            ),
            "value_area_migration": self.value_area_migration,
            "composite_signal": self.composite_signal,
        }


# ==============================================================================
# LOADING / NORMALIZATION (Polars)
# ==============================================================================


_TS_FORMATS: Tuple[str, ...] = (
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%dT%H:%M:%S%.f%z",
    "%Y-%m-%d %H:%M:%S%z",
    "%Y-%m-%d %H:%M:%S%.f%z",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S%.f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
)


def _ensure_ist(expr_col: str, df: pl.DataFrame) -> pl.DataFrame:
    """
    Parse and convert the timestamp column to an IST-aware datetime.

    Polars >= 1.x refuses (and, with strict=False, silently nulls) `str.to_datetime`
    when the payload carries a timezone offset but no format/timezone is supplied.
    We therefore probe a short list of common NSE/BSE timestamp formats and keep
    the parse that loses the fewest rows — fail-soft, never raises.
    """
    schema = df.schema.get(expr_col)
    if schema == pl.String:
        best_series: Optional[pl.Series] = None
        best_nulls: Optional[int] = None
        for fmt in _TS_FORMATS:
            try:
                series = df.select(
                    pl.col(expr_col).str.to_datetime(
                        format=fmt, strict=False, time_unit="us"
                    )
                ).get_column(expr_col)
            except Exception:  # noqa: BLE001 — malformed format on this data
                continue
            nulls = int(series.null_count())
            if best_nulls is None or nulls < best_nulls:
                best_series, best_nulls = series, nulls
            if nulls == 0:
                break
        if best_series is not None and best_nulls != df.height:
            df = df.with_columns(best_series.alias(expr_col))
    dtype = df.schema.get(expr_col)
    if isinstance(dtype, pl.Datetime):
        if dtype.time_zone is None:
            df = df.with_columns(
                pl.col(expr_col)
                .dt.replace_time_zone(IST, ambiguous="earliest")
                .alias(expr_col)
            )
        elif dtype.time_zone != IST:
            df = df.with_columns(
                pl.col(expr_col).dt.convert_time_zone(IST).alias(expr_col)
            )
    return df


def load_bars(
    source: Union[str, Path, pl.DataFrame],
    *,
    timestamp_col: str = "timestamp",
) -> pl.DataFrame:
    """
    Normalize an OHLCV source into a clean, sorted, IST-aware Polars frame.

    Accepts a parquet/CSV path or an in-memory Polars DataFrame. Missing volume
    is coerced to 0, negative volume clipped to 0, invalid high/low relationships
    repaired, and NaN/duplicate timestamps dropped. Never raises on bad data —
    returns an empty (but schema-correct) frame instead.
    """
    try:
        if isinstance(source, pl.DataFrame):
            df = source
        else:
            path = str(source)
            if path.endswith(".csv"):
                df = pl.read_csv(path, try_parse_dates=False)
            else:
                df = pl.read_parquet(path)
    except Exception as exc:  # noqa: BLE001 — fail-soft by contract
        log.warning("load_bars failed to read %r: %s", source, exc)
        return pl.DataFrame()

    if df.height == 0:
        return df

    if timestamp_col not in df.columns:
        log.warning("load_bars: missing timestamp column %r", timestamp_col)
        return pl.DataFrame()

    df = _ensure_ist(timestamp_col, df)

    # Coerce numerics; drop rows that cannot form a bar.
    select: List[pl.Expr] = [pl.col(timestamp_col)]
    for col in _OHLCV:
        if col in df.columns:
            select.append(pl.col(col).cast(pl.Float64, strict=False).alias(col))
        else:
            select.append(pl.lit(None, dtype=pl.Float64).alias(col))
    df = df.select(select)

    df = df.drop_nulls(subset=["timestamp", "high", "low", "close"])
    if df.height == 0:
        return df

    # Repair inverted/zero ranges and non-positive prices; clip negative volume.
    hi = pl.max_horizontal(pl.col("high"), pl.col("low"))
    lo = pl.min_horizontal(pl.col("high"), pl.col("low"))
    df = df.with_columns(
        [
            hi.alias("high"),
            lo.alias("low"),
            pl.col("close").clip(lower_bound=0.0).alias("close"),
            pl.col("open").fill_null(pl.col("close")).alias("open"),
            pl.col("volume").fill_null(0.0).clip(lower_bound=0.0).alias("volume"),
        ]
    )
    df = df.filter(pl.col("high") > 0)
    df = df.unique(subset=["timestamp"], keep="last").sort("timestamp")
    return df


# ==============================================================================
# WINDOWING
# ==============================================================================


def _slice_window(df: pl.DataFrame, window_days: int) -> pl.DataFrame:
    """Keep the last `window_days` distinct trading dates (IST calendar)."""
    if df.height == 0 or window_days <= 0:
        return df.head(0)
    dated = df.with_columns(pl.col("timestamp").dt.date().alias("_trading_day"))
    days = dated.get_column("_trading_day").unique().sort(descending=True).head(window_days)
    if days.len() == 0:
        return df.head(0)
    return dated.filter(pl.col("_trading_day").is_in(days.to_list())).drop("_trading_day")


# ==============================================================================
# NUMERIC KERNEL
# ==============================================================================


def _validate_profile_config(n_bins: int, value_area_pct: float) -> Tuple[int, float]:
    n = int(n_bins)
    if n < 2:
        n = 2
    if n > 5000:
        n = 5000
    pct = float(value_area_pct)
    if not math.isfinite(pct) or pct <= 0.0:
        pct = 0.70
    elif pct > 1.0:
        pct = 1.0
    return n, pct


def _distribute_volume(
    lows: np.ndarray,
    highs: np.ndarray,
    volumes: np.ndarray,
    bin_lo: np.ndarray,
    bin_hi: np.ndarray,
    price_low: float,
    bin_size: float,
) -> np.ndarray:
    """
    Vectorized range-distribution of bar volume onto price bins.

    For every bar i and bin j:
        overlap = max(0, min(high_i, bin_hi_j) - max(low_i, bin_lo_j))
        weight  = overlap / (high_i - low_i)          (uniform across the range)
        contrib = volume_i * weight

    Zero-range (doji) bars drop all their volume into the bin containing their
    single traded price. Returns a float64 array of shape (n_bins,).
    """
    n_bins = bin_lo.shape[0]
    if lows.shape[0] == 0:
        return np.zeros(n_bins, dtype=np.float64)

    span = highs - lows
    flat = span <= 0.0

    # Overlap matrix (n_bars, n_bins) — broadcast width comparisons.
    upper = np.minimum(highs[:, None], bin_hi[None, :])
    lower = np.maximum(lows[:, None], bin_lo[None, :])
    overlap = np.maximum(0.0, upper - lower)

    with np.errstate(divide="ignore", invalid="ignore"):
        weights = overlap / span[:, None]
    weights = np.where(np.isfinite(weights), weights, 0.0)

    if np.any(flat):
        # Single traded price: assign to the containing bin via searchsorted.
        centers = bin_lo + bin_size / 2.0
        flat_idx = np.nonzero(flat)[0]
        price = lows[flat_idx]
        bin_of = np.searchsorted(centers, price, side="left")
        bin_of = np.clip(bin_of, 0, n_bins - 1)
        weights[flat_idx, :] = 0.0
        weights[flat_idx, bin_of] = 1.0

    profile = weights.T @ volumes
    profile = np.nan_to_num(profile, nan=0.0, posinf=0.0, neginf=0.0)
    return np.clip(profile, 0.0, None)


def _compute_value_area(
    profile: np.ndarray,
    edges: np.ndarray,
    value_area_pct: float,
) -> ValueArea:
    """Classic POC-anchored value area expansion to `value_area_pct` of volume."""
    n = profile.shape[0]
    total = float(profile.sum())
    poc_bin = int(np.argmax(profile)) if n else 0
    if total <= 0.0 or n == 0:
        return ValueArea(
            poc=float(edges[0]) if edges.size else 0.0,
            poc_volume=0.0,
            poc_bin=0,
            val=float(edges[0]) if edges.size else 0.0,
            vah=float(edges[-1]) if edges.size else 0.0,
            val_bin=0,
            vah_bin=max(0, n - 1),
            captured_pct=0.0,
        )

    target = total * value_area_pct
    lower = upper = poc_bin
    cumulative = float(profile[poc_bin])

    # Expand to whichever adjacent bin holds more volume until target is met.
    while cumulative < target and (lower > 0 or upper < n - 1):
        up_vol = float(profile[upper + 1]) if upper < n - 1 else -1.0
        down_vol = float(profile[lower - 1]) if lower > 0 else -1.0
        if up_vol >= down_vol:
            upper += 1
            cumulative += float(profile[upper])
        else:
            lower -= 1
            cumulative += float(profile[lower])

    return ValueArea(
        poc=float((edges[poc_bin] + edges[poc_bin + 1]) / 2.0),
        poc_volume=float(profile[poc_bin]),
        poc_bin=poc_bin,
        val=float(edges[lower]),
        vah=float(edges[upper + 1]),
        val_bin=lower,
        vah_bin=upper,
        captured_pct=float(cumulative / total),
    )


def _moving_average(values: np.ndarray, window: int) -> np.ndarray:
    """Edge-safe moving average (same length, 'valid' convolved + edge pad)."""
    if values.size == 0:
        return values
    w = max(1, int(window))
    if w <= 1 or values.size == 1:
        return values.copy()
    w = min(w, values.size)
    kernel = np.ones(w, dtype=np.float64) / float(w)
    valid = np.convolve(values, kernel, mode="valid")
    pad_left = (w - 1) // 2
    pad_right = (w - 1) - pad_left
    left = np.full(pad_left, valid[0], dtype=np.float64)
    right = np.full(pad_right, valid[-1], dtype=np.float64)
    return np.concatenate([left, valid, right])[: values.size]


def _local_extrema(smoothed: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Indices of local maxima / minima including endpoints (edge-padded)."""
    n = smoothed.shape[0]
    if n == 0:
        return np.array([], dtype=int), np.array([], dtype=int)
    if n == 1:
        return np.array([0], dtype=int), np.array([0], dtype=int)
    left = np.concatenate([[-np.inf], smoothed[:-1]])
    right = np.concatenate([smoothed[1:], [-np.inf]])
    maxima = np.nonzero((smoothed >= left) & (smoothed > right))[0]
    left_min = np.concatenate([[np.inf], smoothed[:-1]])
    right_min = np.concatenate([smoothed[1:], [np.inf]])
    minima = np.nonzero((smoothed <= left_min) & (smoothed < right_min))[0]
    return maxima, minima


def _detect_nodes(
    profile: np.ndarray,
    edges: np.ndarray,
    *,
    smooth_window: int,
    hvn_sigma: float,
    lvn_sigma: float,
    min_relative_volume: float,
    max_nodes: int,
) -> Tuple[List[VolumeNode], List[VolumeNode]]:
    """Detect HVN shelves and LVN vacuums from a smoothed profile."""
    if profile.size == 0:
        return [], []
    smoothed = _moving_average(profile, smooth_window)
    mu = float(smoothed.mean())
    sd = float(smoothed.std())
    peak = float(smoothed.max())
    trough = float(smoothed.min())
    max_vol = float(profile.max()) if profile.size else 0.0
    if max_vol <= 0.0:
        return [], []

    maxima, minima = _local_extrema(smoothed)
    hvn_hi = mu + max(0.0, hvn_sigma) * sd
    lvn_lo = mu - max(0.0, lvn_sigma) * sd
    min_vol = min_relative_volume * max_vol

    def _node(idx: int, kind: NodeKind) -> VolumeNode:
        if kind == "HVN":
            denom = (peak - mu) if (peak - mu) > 0 else 1.0
            strength = float(np.clip((smoothed[idx] - mu) / denom, 0.0, 1.0))
        else:
            denom = (mu - trough) if (mu - trough) > 0 else 1.0
            strength = float(np.clip((mu - smoothed[idx]) / denom, 0.0, 1.0))
        return VolumeNode(
            kind=kind,
            price=float((edges[idx] + edges[idx + 1]) / 2.0),
            lower=float(edges[idx]),
            upper=float(edges[idx + 1]),
            volume=float(profile[idx]),
            strength=round(strength, 6),
            bin_index=int(idx),
        )

    hvns = [
        _node(int(i), "HVN")
        for i in maxima
        if float(smoothed[i]) >= hvn_hi and float(profile[i]) >= min_vol
    ]
    lvns = [
        _node(int(i), "LVN")
        for i in minima
        if float(smoothed[i]) <= lvn_lo
    ]

    hvns.sort(key=lambda n: n.volume, reverse=True)
    lvns.sort(key=lambda n: n.volume)
    return hvns[:max_nodes], lvns[:max_nodes]


def _relative_levels(
    profile: VolumeProfile,
    reference_price: Optional[float],
) -> Optional[RelativeLevels]:
    """Nearest HVN/LVN above/below a reference price (support/resistance map)."""
    if reference_price is None or not math.isfinite(reference_price) or reference_price <= 0:
        return None
    nodes = list(profile.hvn) + list(profile.lvn)
    if not nodes:
        return RelativeLevels(
            reference_price=float(reference_price),
            nearest_hvn_above=None,
            nearest_hvn_below=None,
            nearest_lvn_above=None,
            nearest_lvn_below=None,
            hvn_above_dist_pct=None,
            hvn_below_dist_pct=None,
            lvn_above_dist_pct=None,
            lvn_below_dist_pct=None,
            position=_position(reference_price, profile.value_area),
        )

    def _nearest(kind: NodeKind, above: bool) -> Optional[float]:
        prices = [
            n.price
            for n in nodes
            if n.kind == kind and ((n.price >= reference_price) if above else (n.price <= reference_price))
        ]
        if not prices:
            return None
        return min(prices) if above else max(prices)

    def _dist(level: Optional[float]) -> Optional[float]:
        if level is None or reference_price <= 0:
            return None
        return abs(level - reference_price) / reference_price * 100.0

    hvn_above = _nearest("HVN", True)
    hvn_below = _nearest("HVN", False)
    lvn_above = _nearest("LVN", True)
    lvn_below = _nearest("LVN", False)

    return RelativeLevels(
        reference_price=float(reference_price),
        nearest_hvn_above=hvn_above,
        nearest_hvn_below=hvn_below,
        nearest_lvn_above=lvn_above,
        nearest_lvn_below=lvn_below,
        hvn_above_dist_pct=_dist(hvn_above),
        hvn_below_dist_pct=_dist(hvn_below),
        lvn_above_dist_pct=_dist(lvn_above),
        lvn_below_dist_pct=_dist(lvn_below),
        position=_position(reference_price, profile.value_area),
    )


def _position(price: float, va: ValueArea) -> NodeRole:
    if va.vah <= va.val:
        return "in_value_area"
    if price > va.vah:
        return "above_va"
    if price < va.val:
        return "below_va"
    return "in_value_area"


# ==============================================================================
# PUBLIC API
# ==============================================================================


def compute_volume_profile(
    bars: pl.DataFrame,
    *,
    window_days: int = 5,
    n_bins: int = 100,
    value_area_pct: float = 0.70,
    smooth_window: int = 3,
    hvn_sigma: float = 1.0,
    lvn_sigma: float = 1.0,
    min_relative_volume: float = 0.01,
    max_nodes: int = 10,
    reference_price: Optional[float] = None,
    include_bins: bool = False,
) -> VolumeProfile:
    """
    Compute a single-window volume profile with POC / VAH / VAL / HVN / LVN.

    Parameters
    ----------
    bars : pl.DataFrame
        Normalized OHLCV frame (see `load_bars`). Must contain timestamp, high,
        low, close, volume.
    window_days : int
        Number of most-recent *distinct trading days* to include (5 or 30).
    n_bins : int
        Number of price buckets the traded range is discretized into.
    value_area_pct : float
        Fraction of total volume the value area must capture (0.70 default).
    smooth_window : int
        Moving-average window (in bins) applied before node detection.
    hvn_sigma / lvn_sigma : float
        Standard-deviation thresholds above/below the mean for node detection.
    min_relative_volume : float
        Node volume floor as a fraction of peak bin volume (noise gate).
    reference_price : float, optional
        Price for the support/resistance map; defaults to last close.
    include_bins : bool
        Attach the full per-bin histogram to the result (chart payloads).

    Returns
    -------
    VolumeProfile — always a well-formed object, even for degenerate input.
    """
    n_bins, value_area_pct = _validate_profile_config(n_bins, value_area_pct)
    window = _slice_window(bars, window_days) if bars is not None and bars.height else bars
    if window is None or window.height == 0:
        return _empty_profile(window_days, n_bins, reference_price)

    lows = window.get_column("low").to_numpy().astype(np.float64)
    highs = window.get_column("high").to_numpy().astype(np.float64)
    closes = window.get_column("close").to_numpy().astype(np.float64)
    volumes = window.get_column("volume").to_numpy().astype(np.float64)

    finite = np.isfinite(lows) & np.isfinite(highs) & np.isfinite(volumes)
    lows, highs, volumes, closes = (
        lows[finite],
        highs[finite],
        volumes[finite],
        closes[finite],
    )
    if lows.size == 0:
        return _empty_profile(window_days, n_bins, reference_price)

    price_low = float(lows.min())
    price_high = float(highs.max())
    if not math.isfinite(price_low) or not math.isfinite(price_high):
        return _empty_profile(window_days, n_bins, reference_price)

    if price_high <= price_low:
        # Flat tape: single effective bin.
        edges = np.array([price_low, price_low + (abs(price_low) * 1e-4 or 1e-4)], dtype=np.float64)
        profile = np.array([float(volumes.sum())], dtype=np.float64)
        bin_size = float(edges[1] - edges[0])
    else:
        edges = np.linspace(price_low, price_high, n_bins + 1, dtype=np.float64)
        bin_lo = edges[:-1]
        bin_hi = edges[1:]
        bin_size = float(edges[1] - edges[0])
        profile = _distribute_volume(lows, highs, volumes, bin_lo, bin_hi, price_low, bin_size)

    value_area = _compute_value_area(profile, edges, value_area_pct)
    hvn, lvn = _detect_nodes(
        profile,
        edges,
        smooth_window=smooth_window,
        hvn_sigma=hvn_sigma,
        lvn_sigma=lvn_sigma,
        min_relative_volume=min_relative_volume,
        max_nodes=max_nodes,
    )

    ref = reference_price
    if ref is None and closes.size:
        ref = float(closes[-1])

    first_ts = window.get_column("timestamp")[0]
    last_ts = window.get_column("timestamp")[-1]

    profile_obj = VolumeProfile(
        window_days=int(window_days),
        n_bins=int(profile.shape[0]),
        price_low=price_low,
        price_high=price_high,
        bin_size=bin_size,
        total_volume=float(profile.sum()),
        value_area=value_area,
        hvn=hvn,
        lvn=lvn,
        relative=None,
        bars_used=int(window.height),
        first_timestamp=str(first_ts),
        last_timestamp=str(last_ts),
        profile=profile if not include_bins else None,
        bins=(
            [
                {
                    "price": round(float((edges[i] + edges[i + 1]) / 2.0), 6),
                    "lower": round(float(edges[i]), 6),
                    "upper": round(float(edges[i + 1]), 6),
                    "volume": round(float(profile[i]), 4),
                }
                for i in range(profile.shape[0])
            ]
            if include_bins
            else None
        ),
    )
    rel = _relative_levels(profile_obj, ref if ref is not None else None)
    if rel is None:
        return profile_obj
    return VolumeProfile(
        window_days=profile_obj.window_days,
        n_bins=profile_obj.n_bins,
        price_low=profile_obj.price_low,
        price_high=profile_obj.price_high,
        bin_size=profile_obj.bin_size,
        total_volume=profile_obj.total_volume,
        value_area=profile_obj.value_area,
        hvn=profile_obj.hvn,
        lvn=profile_obj.lvn,
        relative=rel,
        bars_used=profile_obj.bars_used,
        first_timestamp=profile_obj.first_timestamp,
        last_timestamp=profile_obj.last_timestamp,
        profile=profile_obj.profile,
        bins=profile_obj.bins,
    )


def _empty_profile(
    window_days: int,
    n_bins: int,
    reference_price: Optional[float],
) -> VolumeProfile:
    return VolumeProfile(
        window_days=int(window_days),
        n_bins=int(n_bins),
        price_low=0.0,
        price_high=0.0,
        bin_size=0.0,
        total_volume=0.0,
        value_area=ValueArea(0.0, 0.0, 0, 0.0, 0.0, 0, 0, 0.0),
        hvn=[],
        lvn=[],
        relative=None,
        bars_used=0,
        first_timestamp=None,
        last_timestamp=None,
    )


def compute_multi_window_profile(
    bars: pl.DataFrame,
    *,
    windows: Sequence[int] = (5, 30),
    n_bins: int = 100,
    value_area_pct: float = 0.70,
    smooth_window: int = 3,
    hvn_sigma: float = 1.0,
    lvn_sigma: float = 1.0,
    min_relative_volume: float = 0.01,
    max_nodes: int = 10,
    include_bins: bool = False,
) -> MultiWindowProfile:
    """
    Compute 5-day and 30-day profiles side by side and derive the composite
    structure signal (POC migration + value-area overlap).
    """
    ordered = sorted({int(w) for w in windows if int(w) > 0})
    if not ordered:
        ordered = [5, 30]
    if len(ordered) == 1:
        ordered = [ordered[0], ordered[0] * 6]

    profiles: Dict[int, VolumeProfile] = {}
    for w in ordered:
        profiles[w] = compute_volume_profile(
            bars,
            window_days=w,
            n_bins=n_bins,
            value_area_pct=value_area_pct,
            smooth_window=smooth_window,
            hvn_sigma=hvn_sigma,
            lvn_sigma=lvn_sigma,
            min_relative_volume=min_relative_volume,
            max_nodes=max_nodes,
            include_bins=include_bins,
        )

    short = ordered[0]
    long = ordered[-1]
    sp = profiles[short]
    lp = profiles[long]

    poc_shift_pct = _safe_pct_shift(sp.value_area.poc, lp.value_area.poc)
    overlap = _value_area_overlap_pct(sp, lp)
    migration = _classify_migration(sp, lp, poc_shift_pct)
    signal = _composite_signal(sp, lp, overlap, poc_shift_pct)

    return MultiWindowProfile(
        profiles=profiles,
        short_window=short,
        long_window=long,
        poc_shift_pct=poc_shift_pct,
        value_area_overlap_pct=overlap,
        value_area_migration=migration,
        composite_signal=signal,
    )


def _safe_pct_shift(short_poc: float, long_poc: float) -> Optional[float]:
    if long_poc <= 0 or not math.isfinite(long_poc) or not math.isfinite(short_poc):
        return None
    return (short_poc - long_poc) / long_poc * 100.0


def _value_area_overlap_pct(a: VolumeProfile, b: VolumeProfile) -> Optional[float]:
    if a.value_area.vah <= a.value_area.val or b.value_area.vah <= b.value_area.val:
        return None
    lo = max(a.value_area.val, b.value_area.val)
    hi = min(a.value_area.vah, b.value_area.vah)
    overlap = max(0.0, hi - lo)
    denom = min(a.value_area.vah - a.value_area.val, b.value_area.vah - b.value_area.val)
    if denom <= 0:
        return None
    return min(100.0, overlap / denom * 100.0)


def _classify_migration(
    short: VolumeProfile,
    long: VolumeProfile,
    poc_shift_pct: Optional[float],
) -> Optional[str]:
    if poc_shift_pct is None:
        return None
    if abs(poc_shift_pct) < 0.5:
        return "stable"
    if short.value_area.poc > long.value_area.poc:
        return "ascending" if poc_shift_pct > 2.0 else "mild_up"
    return "descending" if poc_shift_pct < -2.0 else "mild_down"


def _composite_signal(
    short: VolumeProfile,
    long: VolumeProfile,
    overlap_pct: Optional[float],
    poc_shift_pct: Optional[float],
) -> Optional[str]:
    """Coarse structural regime tag used by the alpha daemon."""
    if short.total_volume <= 0 or long.total_volume <= 0:
        return None
    ref = short.relative.reference_price if short.relative else None
    if ref is None:
        return None
    in_short_va = short.value_area.val <= ref <= short.value_area.vah
    if overlap_pct is not None and overlap_pct < 25.0 and poc_shift_pct is not None:
        if poc_shift_pct > 0.5:
            return "value_migration_up"
        if poc_shift_pct < -0.5:
            return "value_migration_down"
    if in_short_va and short.relative and short.relative.position == "in_value_area":
        return "balanced_acceptance"
    if ref > short.value_area.vah:
        return "acceptance_above_value"
    if ref < short.value_area.val:
        return "acceptance_below_value"
    return "rotational"


def profile_from_parquet(
    path: Union[str, Path],
    *,
    window_days: int = 5,
    **kwargs: Any,
) -> VolumeProfile:
    """Convenience: load a parquet path and compute a single-window profile."""
    return compute_volume_profile(load_bars(path), window_days=window_days, **kwargs)


def multi_profile_from_parquet(
    path: Union[str, Path],
    *,
    windows: Sequence[int] = (5, 30),
    **kwargs: Any,
) -> MultiWindowProfile:
    """Convenience: load a parquet path and compute the multi-window profile."""
    return compute_multi_window_profile(load_bars(path), windows=windows, **kwargs)


# ==============================================================================
# SELF-TEST
# ==============================================================================


def _self_test() -> None:  # pragma: no cover - manual smoke
    candidates = sorted(Path("data/underlying").glob("*/5minute/data.parquet"))
    if not candidates:
        print("No underlying parquet data found; skipping self-test.")
        return
    sample = candidates[0]
    print(f"Self-test on {sample}")
    frame = load_bars(sample)
    print(f"  bars loaded: {frame.height}  columns: {frame.columns}")
    multi = compute_multi_window_profile(frame, windows=(5, 30), include_bins=False)
    for w, prof in multi.profiles.items():
        print(
            f"  [{w}d] POC={prof.value_area.poc:.2f} "
            f"VAL={prof.value_area.val:.2f} VAH={prof.value_area.vah:.2f} "
            f"captured={prof.value_area.captured_pct:.2%} bins={prof.n_bins} "
            f"HVN={len(prof.hvn)} LVN={len(prof.lvn)}"
        )
    print(f"  POC shift(5d vs 30d)={multi.poc_shift_pct} signal={multi.composite_signal}")


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    _self_test()
