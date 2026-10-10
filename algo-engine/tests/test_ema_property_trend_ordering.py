# Feature: intraday-strategy-suite, Property 21
"""Property 21 - EMA ordering determines trend and entry eligibility.

This module owns a single property: the EMA Trend Pullback strategy classifies the
trend purely from the *strict* ordering of its EMA stack, and refuses to emit an entry
when the stack is not strictly ordered.

    fast > medium > slow   =>  trend "up"
    fast < medium < slow   =>  trend "down"
    any other arrangement  =>  trend "flat" and NO entry Signal

Strategy under test: ``strategies.ema_trend_pullback.EMATrendPullback``. The EMA stack
is driven directly by setting ``state.ema_fast`` / ``state.ema_med`` / ``state.ema_slow``
to generated values, so the property isolates the classification + entry-eligibility
rule from the incremental EMA recurrence (covered by Property 20). The "flat => no
entry" half is checked by asserting ``_decide(candle, t)`` returns None for any
non-strictly-ordered stack.

Validates: Requirements 10.2, 10.3, 10.7
"""

from __future__ import annotations

import datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from strategies.ema_trend_pullback import EMATrendPullback


# Bounded, finite EMA values. Drawn as a 3-element unique list so distinct values
# yield strict inequalities; ties are injected explicitly in the "flat" cases below.
_EMA_VALUES = st.floats(
    min_value=-1.0e6, max_value=1.0e6, allow_nan=False, allow_infinity=False
)


def _reference_trend(fast: float, med: float, slow: float) -> str:
    """Ground-truth trend per the strict-ordering definition (Req 10.2, 10.3, 10.7)."""
    if fast > med > slow:
        return "up"
    if fast < med < slow:
        return "down"
    return "flat"


@st.composite
def _ema_stacks(draw):
    """Draw an (ema_fast, ema_med, ema_slow) stack covering up / down / unordered cases.

    A mode is sampled so every branch is exercised on every run:
      - "up":   strictly fast > med > slow
      - "down": strictly fast < med < slow
      - "tie":  at least two EMAs equal (never strictly ordered)
      - "perm": a distinct permutation that is not strictly monotonic
    """
    lo, mid, hi = sorted(draw(st.lists(_EMA_VALUES, min_size=3, max_size=3, unique=True)))
    mode = draw(st.sampled_from(["up", "down", "tie", "perm"]))

    if mode == "up":
        return (hi, mid, lo)
    if mode == "down":
        return (lo, mid, hi)
    if mode == "tie":
        # Each of these has a tie, so none is strictly ordered => flat.
        return draw(st.sampled_from([(mid, mid, lo), (hi, mid, mid), (mid, mid, mid)]))
    # "perm": distinct values arranged non-monotonically => flat.
    return draw(
        st.sampled_from([(mid, hi, lo), (mid, lo, hi), (hi, lo, mid), (lo, hi, mid)])
    )


def _candle(price: float) -> dict:
    """A minimal valid candle (all guaranteed fields present)."""
    return {
        "high": price + 1.0,
        "low": price - 1.0,
        "close": price,
        "time": datetime.time(11, 0, 0),
    }


@pytest.mark.property
@settings(max_examples=100)
@given(stack=_ema_stacks(), price=_EMA_VALUES)
def test_ema_ordering_determines_trend_and_entry_eligibility(stack, price):
    """Strict EMA ordering fixes the trend; a non-ordered stack emits no entry."""
    fast, med, slow = stack
    expected = _reference_trend(fast, med, slow)

    strategy = EMATrendPullback(config={})
    # Drive the EMA stack directly to isolate the classification rule.
    strategy.state.ema_fast = fast
    strategy.state.ema_med = med
    strategy.state.ema_slow = slow

    # 1. Trend classification matches the strict-ordering definition (Req 10.2, 10.3).
    assert strategy._classify_trend() == expected

    # 2. A non-strictly-ordered (flat) stack must produce no entry (Req 10.7).
    if expected == "flat":
        t = datetime.time(11, 0, 0)
        # eff_open is normally set by _update_indicators; provide it for completeness.
        strategy.state.eff_open = float(price)
        assert strategy._decide(_candle(float(price)), t) is None
