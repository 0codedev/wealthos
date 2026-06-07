"""python-bridge/ml/walk_forward.py

Time-ordered walk-forward cross-validation. The ONLY validation strategy we use
for trade outcome models — random K-fold leaks future info and overstates
performance. Live trading is strictly time-ordered, so validation must be too.

A walk-forward scheme slides a (train, val) window forward through the data:
  fold 0: train [0..60) val [60..67)
  fold 1: train [0..67) val [67..74)
  ...
  fold k: train [0..60+7k) val [60+7k..67+7k)

The expanding-train, sliding-val pattern mirrors how a real trader would have
trained and used the model in production.

We keep at least `min_train_days` in the initial train window so the model has
enough data to learn from.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Sequence


@dataclass(frozen=True)
class WalkForwardFold:
    """A single (train, val) split. Indices refer to rows of the input array."""
    fold_index: int
    train_indices: tuple[int, ...]
    val_indices: tuple[int, ...]
    train_start_date: date | None
    val_start_date: date | None
    val_end_date: date | None


def walk_forward_splits(
    n_samples: int,
    dates: Sequence[date] | None = None,
    *,
    train_days: int = 60,
    val_days: int = 7,
    min_train_days: int = 60,
    step_days: int | None = None,
) -> list[WalkForwardFold]:
    """Yield walk-forward (train, val) index pairs.

    Args:
        n_samples: total number of rows in the dataset (in time order).
        dates: optional parallel array of dates per row. If provided, dates are
            attached to each fold for reporting. The folds themselves are
            determined by *count*, not by date gaps, so weekends/holidays are
            handled implicitly.
        train_days: number of *most recent* training rows before the val window.
        val_days: number of rows in the validation window.
        min_train_days: ignore folds where the train window has fewer rows.
        step_days: how far to slide the window between folds. Defaults to
            `val_days` (non-overlapping val windows). Use `1` for maximum fold
            count; use `val_days` for speed.

    Returns:
        A list of `WalkForwardFold`s in time order. May be empty if the dataset
        is too small to produce at least one fold.
    """
    if n_samples < 2:
        return []
    if step_days is None:
        step_days = val_days
    if step_days < 1:
        raise ValueError(f"step_days must be >= 1, got {step_days}")
    if train_days < min_train_days:
        raise ValueError(
            f"train_days ({train_days}) must be >= min_train_days ({min_train_days})"
        )

    folds: list[WalkForwardFold] = []
    fold_index = 0
    # The first val window starts at index = train_days and ends at train_days+val_days.
    val_start = train_days
    while val_start + val_days <= n_samples:
        train_start = max(0, val_start - train_days)
        train_end = val_start
        if (train_end - train_start) < min_train_days:
            val_start += step_days
            continue

        train_idx = tuple(range(train_start, train_end))
        val_idx = tuple(range(val_start, val_start + val_days))
        train_start_d = dates[train_start] if dates is not None else None
        val_start_d = dates[val_start] if dates is not None else None
        val_end_d = dates[val_start + val_days - 1] if dates is not None else None
        folds.append(WalkForwardFold(
            fold_index=fold_index,
            train_indices=train_idx,
            val_indices=val_idx,
            train_start_date=train_start_d,
            val_start_date=val_start_d,
            val_end_date=val_end_d,
        ))
        fold_index += 1
        val_start += step_days
    return folds


def last_fold(n_samples: int, train_days: int = 60) -> WalkForwardFold | None:
    """Convenience: return only the most-recent fold (used for promotion testing)."""
    folds = walk_forward_splits(n_samples, train_days=train_days, val_days=1)
    return folds[-1] if folds else None


def iter_rows(rows: Iterable, indices: Sequence[int]):
    """Tiny helper: yield rows[indices[i]] in order."""
    rows = list(rows)
    for i in indices:
        yield rows[i]
